import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../api';
import { useToast } from '../contexts/ToastContext';
import { MasterSelect } from './ui/MasterSelect';
import { MasterDatePicker } from './ui/MasterDatePicker';

/**
 * Record Payment (settlement) for an APPROVED expense claim — styled like the
 * app's "Payment Summary Against PO" screen (teal header + progress bar):
 *
 *  Overview (step 1) — the claim + employee's proof, the ONE-TIME deduction
 *    (editable only until the first payment locks it), the net-payable summary,
 *    and the PAYMENT HISTORY table. A single expense can be paid in several
 *    installments, so this is the landing screen you return to after each payment.
 *  Add Payment (step 2) — the payment entry form only: category (defaults to the
 *    claim's, "+" adds a new one), payment method, proof of payment, net payable,
 *    amount (partial allowed), note. Reached via the "+ Add Payment" button.
 *
 * The sanctioned amount = claim − Σ deductions, fixed on the first payment; every
 * later "+ Add Payment" skips straight to the form since deductions are locked.
 */

type Attachment = { name: string; size?: number | null; url: string };
type DeductionRow = { amount: number; reason: string };

type Summary = {
  id: number;
  claim_no: string | null;
  title: string;
  employee_name: string | null;
  expense_date: string | null;
  currency: string | null;
  claimed_amount: number;
  purpose?: string | null;
  vendor?: string | null;
  project?: string | null;
  category_id: number | null;
  category_name: string | null;
  sanctioned_amount: number | null;
  deduction_amount: number;
  deductions: DeductionRow[];
  addition_amount: number;
  additions: DeductionRow[];
  total_paid: number;
  remaining_amount: number | null;
  settlement_status: 'unpaid' | 'partial' | 'paid';
  manager_status?: 'pending' | 'approved' | 'rejected';
  hr_status?: 'pending' | 'approved' | 'rejected';
  attachments: Attachment[];
  payments: {
    id: number; amount: number; category_name: string | null;
    payment_type: string | null; expense_type: string | null;
    note: string | null; proof_name: string | null; proof_url: string | null;
    zoho_status: string | null; zoho_expense_url: string | null;
    paid_by_name: string | null; paid_at: string | null;
  }[];
  // Salary-recovery schedule (self advance).
  recovery_start?: string | null;
  recovery_mode?: 'emi' | 'lumpsum' | 'bimonthly' | string | null;
  recovery_months?: number | null;
  monthly_emi?: number | null;
  // What payroll has actually recovered so far (self stream) — drives the
  // Pending → Recovered status on the schedule instead of always "Pending".
  recovery_ledger?: { year: number; month: number; amount: number; carried: number }[];
  recovery_recovered?: number;
  // Advance-only settle context (company advances).
  employee_id?: number | null;
  used_for?: 'self' | 'company' | string;
  employee_settled_at?: string | null;
  // Settlement approval gate — branch/HR approve the usage before payout.
  settle_approval_status?: 'pending' | 'approved' | 'rejected' | null;
  settle_approval_comment?: string | null;
  settle_approved_at?: string | null;
  settle_actual_amount?: number | null;
  settle_type?: 'equal' | 'return' | 'reimburse' | null;
  settle_balance?: number;
  settle_declared_type?: 'equal' | 'minimum' | 'maximum' | null;
  settle_target_amount?: number | null;
  settle_items?: { amount: number; reason: string; method?: string | null; proof_name: string | null; proof_url: string | null }[];
  settle_reimbursed_at?: string | null;
  settle_reimbursement?: { id: number; claim_no: string; status: string; amount?: number; category?: string | null; currency?: string | null; proof_name?: string | null; proof_url?: string | null } | null;
  settle_returned_at?: string | null;
  settle_return_method?: string | null;
  settle_return_proof_url?: string | null;
  settle_return_payments?: { index?: number; amount: number; method: string; mode: string; note?: string | null; paid_at: string | null; status?: 'pending' | 'approved' | 'rejected'; rejected_reason?: string | null; proof_name: string | null; proof_url: string | null }[];
  settle_return_remaining?: number;
  // Direct return payments confirmed by HR/branch vs. still awaiting approval.
  settle_return_approved?: number;
  settle_return_pending?: number;
  settle_return_scheduled_at?: string | null;
  settle_return_recovery_start?: string | null;
  settle_return_recovery_mode?: 'emi' | 'lumpsum' | 'bimonthly' | null;
  settle_return_recovery_months?: number | null;
  settle_return_monthly?: number | null;
  settle_return_ledger?: { year: number; month: number; amount: number; carried: number }[];
  settle_return_recovered?: number;
  employee_monthly_salary?: number | null;
  emi_ongoing?: number;
  emi_available?: number | null;
};

type Cat = { id: number; name: string; code?: string | null };

const inr = (n: number) => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : `${String(d.getDate()).padStart(2, '0')}-${MONTHS[d.getMonth()]}-${d.getFullYear()}`;
};
const tokenUrl = (u: string) => `${u}${u.includes('?') ? '&' : '?'}token=${encodeURIComponent(localStorage.getItem('cbc_token') || '')}`;

// Download a just-selected (not-yet-uploaded) proof file from the browser.
const downloadFile = (f: File) => {
  const url = URL.createObjectURL(f);
  const a = document.createElement('a');
  a.href = url; a.download = f.name;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

/* Proof of payment accepts a receipt document or a photo of one — nothing
 * else. Spreadsheets and Word files used to be allowed here, which let a
 * .xlsx through as "proof" (CBC #77). The `accept` attribute is only a file-
 * picker hint (a user can switch it to "All files"), so every input pairs it
 * with the runtime check below; the same list is enforced server-side in
 * ExpenseClaimController::settle. */
const PROOF_ACCEPT = '.pdf,.jpg,.jpeg,.png';
const PROOF_EXTS = ['pdf', 'jpg', 'jpeg', 'png'];

// Open a just-selected proof file in a new tab (preview).
const viewFile = (f: File) => {
  const url = URL.createObjectURL(f);
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
};

// KPI icons — same set as the PO "Payment Summary" modal.
const IcoDoc = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>;
const IcoCheck = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><polyline points="8 12 11 15 16 9" /></svg>;
const IcoWallet = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="2" y="6" width="20" height="14" rx="2" /><path d="M16 12h.01M2 10h20" /></svg>;
const IcoMinus = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><line x1="8" y1="12" x2="16" y2="12" /></svg>;
const IcoPlus = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="16" /><line x1="8" y1="12" x2="16" y2="12" /></svg>;

export default function ExpenseSettlementModal({
  claimId, onClose, onDone, readOnly = false, review = false,
  basePath = '/expense-claims', kind = 'expense', allowSettle = false,
  canApproveSettle = false,
  onRaiseReimbursement,
  onGoToInbox,
}: {
  claimId: number | null;
  onClose: () => void;
  onDone: () => void;
  /** View-only mode (e.g. the employee viewing their own claim's payments) —
   *  no deduction editing, no Add Payment; just the settled figures + history. */
  readOnly?: boolean;
  /** HR "Review & Approve" mode — header + KPIs + editable adjustments only;
   *  footer becomes Approve / Reject. Approving locks the adjustments. */
  review?: boolean;
  /** API base for all settlement calls — '/expense-claims' (default) or
   *  '/advance-requests'. Lets the SAME modal drive both flows. */
  basePath?: string;
  /** 'expense' (default) shows Category + Expense Type in the payment form and
   *  the Zoho column in history. 'advance' hides those — an advance payout only
   *  carries amount + method + note + proof. */
  kind?: 'expense' | 'advance';
  /** Employee viewing their OWN company advance — enables the "Settlement"
   *  section's usage form (itemised amount + reason + proof) so they can settle. */
  allowSettle?: boolean;
  /** Branch/HR viewer may approve or reject a pending employee settlement
   *  (advances only). Enables the Approve / Reject Settlement controls. */
  canApproveSettle?: boolean;
  /** When set, "Raise Expense" for a reimburse settlement opens the real
   *  Expense Claim form (pre-filled + amount-capped) instead of auto-creating.
   *  Provided by the Employee Profile where that form lives. */
  onRaiseReimbursement?: (info: { advanceId: number; balance: number; advanceNo: string }) => void;
  /** When set, a claim still at the REPORTING-MANAGER stage is not actionable
   *  here — the modal shows a "approve it in your Inbox" redirect instead of the
   *  manager approve/reject. Passed by the HR Expense page (manager-stage
   *  approvals are Inbox-only); the Inbox itself does NOT pass it, so manager
   *  approval works there. */
  onGoToInbox?: () => void;
}) {
  const toast = useToast();
  const open = claimId != null;
  // Lock background page scroll while the modal is open — the page scrolled
  // behind the overlay (QA #99, #115). The app layout scrolls inside its
  // <main> container (overflow-y:auto), NOT <body>/<html>, so locking those
  // alone did nothing on the Inbox. Lock the scrollable <main> too and restore
  // every element on close/unmount.
  useEffect(() => {
    if (!open) return;
    const html = document.documentElement;
    const body = document.body;
    const main = document.querySelector('main') as HTMLElement | null;
    const prev = {
      html: html.style.overflow,
      body: body.style.overflow,
      main: main?.style.overflow ?? '',
    };
    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    if (main) main.style.overflow = 'hidden';
    return () => {
      html.style.overflow = prev.html;
      body.style.overflow = prev.body;
      if (main) main.style.overflow = prev.main;
    };
  }, [open]);
  const isAdvance = kind === 'advance';
  // Noun for user-facing copy — an advance is a "advance"/"payout", an expense
  // claim is a "claim"/"reimbursement".
  const noun = isAdvance ? 'advance' : 'claim';

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [cats, setCats] = useState<Cat[]>([]);
  // The Add-Payment form opens as its own nested popup over the overview.
  const [showForm, setShowForm] = useState(false);
  // After an inline HR approval we keep the SAME modal open and flip it into
  // payment mode — no reopening the popup just to disburse (QA: "don't break
  // the flow"). Drives `inReview` below.
  const [approvedInline, setApprovedInline] = useState(false);

  // Editable deduction / addition rows (first payment only).
  const [deductions, setDeductions] = useState<{ amount: string; reason: string }[]>([]);
  const [additions, setAdditions] = useState<{ amount: string; reason: string }[]>([]);
  const [amount, setAmount] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [paymentType, setPaymentType] = useState('');
  const [expenseType, setExpenseType] = useState('');
  const [note, setNote] = useState('');
  const [proofFile, setProofFile] = useState<File | null>(null);
  // The proof download is a local blob save, so it finishes instantly and gave
  // no feedback at all — the button now holds a spinner for a moment and locks
  // out repeat clicks so one tap can't queue several saves.
  const [proofDownloading, setProofDownloading] = useState(false);
  const proofDlTimer = useRef<number | null>(null);
  useEffect(() => () => { if (proofDlTimer.current) window.clearTimeout(proofDlTimer.current); }, []);
  const downloadProof = (f: File) => {
    if (proofDownloading) return;
    setProofDownloading(true);
    downloadFile(f);
    proofDlTimer.current = window.setTimeout(() => { proofDlTimer.current = null; setProofDownloading(false); }, 800);
  };
  /* Gate every proof-of-payment picker: returns the file only when it is one of
   * PROOF_EXTS, else warns and returns null so the caller keeps what it had. */
  const acceptProof = (f: File | null | undefined): File | null => {
    if (!f) return null;
    const ext = (f.name.split('.').pop() || '').toLowerCase();
    if (!PROOF_EXTS.includes(ext)) {
      toast.error(
        'Unsupported file type',
        `“${f.name}” can’t be used as proof of payment. Attach a PDF, JPG, JPEG or PNG.`,
      );
      return null;
    }
    // 2 MB cap — reject early with a clear message instead of the server's
    // cryptic "The proof failed to upload" (QA #100).
    if (f.size > 2 * 1024 * 1024) {
      toast.error('File too large', `“${f.name}” is ${(f.size / 1024 / 1024).toFixed(1)} MB — proof must be 2 MB or smaller.`);
      return null;
    }
    return f;
  };
  // Turns on inline field-level errors once a save is attempted.
  const [showErrors, setShowErrors] = useState(false);
  // Collapsible Adjustments (deductions/additions) section.
  const [adjOpen, setAdjOpen] = useState(true);
  // Collapsible Payment History / Advance Paid section.
  const [payOpen, setPayOpen] = useState(true);
  // Proof-of-payment list — collapse to the first few, expand on "+N more".
  const [showAllProofs, setShowAllProofs] = useState(false);
  // Employee "Settlement" (company advance) — itemised usage rows.
  const [settleRows, setSettleRows] = useState<{ amount: string; reason: string; method: string; proof: File | null }[]>([{ amount: '', reason: '', method: '', proof: null }]);
  const [settleNote, setSettleNote] = useState('');
  const [settleErr, setSettleErr] = useState(false);
  const [settleSaving, setSettleSaving] = useState(false);
  const [settleOpen, setSettleOpen] = useState(true);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  // Settle flow: 'idle' → "Add Settle Payment" button; 'choose' → type popup
  // (Equal / Minimum / Maximum, locked once picked); 'form' → itemised rows.
  const [settleMode, setSettleMode] = useState<'idle' | 'choose' | 'form'>('idle');
  const [settleChosen, setSettleChosen] = useState<'' | 'equal' | 'minimum' | 'maximum'>('');
  const [settleChosenTmp, setSettleChosenTmp] = useState<'' | 'equal' | 'minimum' | 'maximum'>('');
  const [settleTarget, setSettleTarget] = useState('');       // declared "amount used" (min/max)
  const [settleTargetTmp, setSettleTargetTmp] = useState(''); // in the choose popup
  const [settleFinalizeAsk, setSettleFinalizeAsk] = useState(false);
  const [raising, setRaising] = useState(false);
  const [settleApprovSaving, setSettleApprovSaving] = useState(false);
  // Ledger index of the return payment whose approve/reject call is in flight.
  const [returnPayBusy, setReturnPayBusy] = useState<number | null>(null);
  // "Make Payment" (return) — mode choice (direct/payroll) + instalment form.
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnMode, setReturnMode] = useState<'' | 'direct' | 'payroll'>('');
  const [returnAmount, setReturnAmount] = useState('');
  const [returnMethod, setReturnMethod] = useState('');
  const [returnProof, setReturnProof] = useState<File | null>(null);
  const [returnSaving, setReturnSaving] = useState(false);
  const [returnErr, setReturnErr] = useState(false);
  // Payroll recovery schedule (when returning via payroll).
  const [returnStep, setReturnStep] = useState<'mode' | 'form'>('mode');
  const [returnRecStart, setReturnRecStart] = useState('');   // YYYY-MM
  const [returnRecType, setReturnRecType] = useState<'' | 'emi' | 'lumpsum' | 'bimonthly'>('');
  const [returnRecMonthly, setReturnRecMonthly] = useState('');
  const [returnRecMonths, setReturnRecMonths] = useState('');
  const [returnNote, setReturnNote] = useState('');
  // Payment row currently being synced to Zoho Books.
  const [syncingId, setSyncingId] = useState<number | null>(null);
  // Zoho bulk-sync: which un-synced payment rows are ticked, and whether a
  // bulk sync is in flight (QA #129).
  const [selectedZoho, setSelectedZoho] = useState<Set<number>>(new Set());
  const [bulkSyncing, setBulkSyncing] = useState(false);
  // Review mode: confirmation dialog ('approve' | 'reject') + reject reason.
  const [confirmKind, setConfirmKind] = useState<null | 'approve' | 'reject'>(null);
  const [rejectReason, setRejectReason] = useState('');

  const firstPayment = !summary?.sanctioned_amount;

  const loadCats = () => {
    // Advances have no category master — an advance payout isn't categorised.
    if (isAdvance) { setCats([]); return Promise.resolve(); }
    return api.get('/expense-claims/categories')
      .then(r => setCats(Array.isArray(r.data) ? r.data : (r.data?.data ?? [])))
      .catch(() => setCats([]));
  };

  useEffect(() => {
    if (!open || claimId == null) { setSummary(null); return; }
    setShowForm(false);
    setApprovedInline(false);
    setConfirmKind(null);
    setRejectReason('');
    setShowAllProofs(false);
    setSettleRows([{ amount: '', reason: '', method: '', proof: null }]);
    setSettleNote('');
    setSettleErr(false);
    setSettleMode('idle');
    setSettleChosen('');
    setSettleChosenTmp('');
    setSettleTarget('');
    setSettleTargetTmp('');
    setSettleFinalizeAsk(false);
    setReturnOpen(false);
    setReturnMode('');
    setReturnAmount('');
    setReturnMethod('');
    setReturnProof(null);
    setReturnErr(false);
    setReturnStep('mode');
    setReturnRecStart('');
    setReturnRecType('');
    setReturnRecMonthly('');
    setReturnRecMonths('');
    setReturnNote('');
    setLoading(true);
    Promise.all([
      api.get<Summary>(`${basePath}/${claimId}/settlement`).then(r => r.data),
      loadCats(),
    ])
      .then(([s]) => {
        setSummary(s);
        const first = !s.sanctioned_amount;
        // Adjustments section: expanded only when the user still needs to enter
        // additions/deductions (editable first payment). Once locked, or in a
        // read-only view, it starts COLLAPSED so the details don't hog vertical
        // space — the user expands it on demand (QA #109).
        setAdjOpen(first && !readOnly);
        // On a fresh (unlocked) claim start with one blank row in each so the
        // inputs are visible by default; otherwise show what was saved.
        const dedRows = (s.deductions ?? []).map(d => ({ amount: String(d.amount), reason: d.reason }));
        const addRows = (s.additions ?? []).map(d => ({ amount: String(d.amount), reason: d.reason }));
        setDeductions(first ? (dedRows.length ? dedRows : [{ amount: '', reason: '' }]) : []);
        setAdditions(first ? (addRows.length ? addRows : [{ amount: '', reason: '' }]) : []);
        const remaining = first ? s.claimed_amount : (s.remaining_amount ?? 0);
        setAmount(String(remaining));
        setCategoryId(s.category_id ? String(s.category_id) : '');
        setPaymentType('');
        setExpenseType('');
        setProofFile(null);
        setNote(`Paid ${inr(remaining)} to ${s.employee_name || 'the employee'} towards "${s.title}".`);
      })
      .catch(() => toast.error('Load failed', `Could not load the ${noun} settlement.`))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, claimId]);

  // Multi-tab sync (QA #107 / #110). The same claim/advance can be open in two
  // tabs; adjustments are locked once on the first submit. When the user comes
  // back to a stale tab, re-pull the settlement so the displayed entries and the
  // Net Payable match the server. If it was finalised elsewhere while we were
  // editing, drop the now-void local adjustment rows and say so.
  useEffect(() => {
    if (!open || claimId == null) return;
    const onSync = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      api.get<Summary>(`${basePath}/${claimId}/settlement`).then(r => {
        const s = r.data;
        const wasUnlocked = !summary?.sanctioned_amount;
        setSummary(s);
        if (wasUnlocked && s.sanctioned_amount) {
          setDeductions([]);
          setAdditions([]);
          toast.info('Synced from another tab',
            `This ${noun}’s adjustments were finalised in another tab — showing the latest figures.`);
        }
      }).catch(() => {});
    };
    document.addEventListener('visibilitychange', onSync);
    window.addEventListener('focus', onSync);
    return () => {
      document.removeEventListener('visibilitychange', onSync);
      window.removeEventListener('focus', onSync);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, claimId, basePath, noun, summary]);

  const claimed = summary?.claimed_amount ?? 0;
  const totalDeduction = useMemo(
    () => +deductions.reduce((s, d) => s + (Number(d.amount) || 0), 0).toFixed(2),
    [deductions],
  );
  const totalAddition = useMemo(
    () => +additions.reduce((s, d) => s + (Number(d.amount) || 0), 0).toFixed(2),
    [additions],
  );
  const paidSoFar = summary?.total_paid ?? 0;
  const sanctioned = firstPayment ? +(claimed - totalDeduction + totalAddition).toFixed(2) : (summary?.sanctioned_amount ?? 0);
  const remaining = +(sanctioned - paidSoFar).toFixed(2);
  const amountNum = Math.max(0, Number(amount) || 0);
  // Zoho bulk-sync selection (QA #129) — only un-synced payment rows are
  // selectable; expense claims only (advances don't sync to Zoho).
  const zohoUnsyncedIds = (summary?.payments ?? []).filter(p => (p.zoho_status || 'not_synced') !== 'synced').map(p => p.id);
  const zohoSelectedIds = zohoUnsyncedIds.filter(id => selectedZoho.has(id));
  const zohoAllSelected = zohoUnsyncedIds.length > 0 && zohoSelectedIds.length === zohoUnsyncedIds.length;
  const showZohoSelect = !readOnly && !isAdvance && zohoUnsyncedIds.length > 0;
  const toggleZoho = (id: number) => setSelectedZoho(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAllZoho = () => setSelectedZoho(zohoAllSelected ? new Set() : new Set(zohoUnsyncedIds));
  const fullyPaid = !firstPayment && remaining <= 0.005;
  const payPct = sanctioned > 0 ? Math.min(100, Math.round((paidSoFar / sanctioned) * 100)) : 0;
  // Review stage: a claim still pending at the manager is a MANAGER review
  // (view-only, approve/reject); once the manager has approved it's an HR review
  // (editable adjustments). Only meaningful when `review` is true.
  const reviewStage: 'manager' | 'hr' = (summary?.manager_status && summary.manager_status !== 'approved') ? 'manager' : 'hr';
  const managerReview = review && reviewStage === 'manager';
  // The review gate used throughout the render. After an inline HR approval it
  // goes false so the SAME modal shows the payment view (Record / Add Payment).
  const inReview = review && !approvedInline;
  // Manager-stage rows opened from the HR Expense page aren't actionable here —
  // the reporting-manager approval is Inbox-only, so show a redirect instead.
  const managerStageRedirect = managerReview && !!onGoToInbox;
  // Deductions are editable only before the first payment, not view-only, and
  // never in a manager review (the manager can't deduct — only approve/reject).
  const editDeductions = firstPayment && !readOnly && !managerReview;

  const setDed = (i: number, patch: Partial<{ amount: string; reason: string }>) =>
    setDeductions(rows => rows.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  const addDed = () => setDeductions(rows => [...rows, { amount: '', reason: '' }]);
  const removeDed = (i: number) => setDeductions(rows => rows.filter((_, idx) => idx !== i));

  const setAdd = (i: number, patch: Partial<{ amount: string; reason: string }>) =>
    setAdditions(rows => rows.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  const addAdd = () => setAdditions(rows => [...rows, { amount: '', reason: '' }]);
  const removeAdd = (i: number) => setAdditions(rows => rows.filter((_, idx) => idx !== i));

  const openPaymentForm = () => {
    setShowErrors(false);
    setAmount(String(remaining));
    setPaymentType('');
    setExpenseType('');
    setProofFile(null);
    setNote(`Paid ${inr(remaining)} to ${summary?.employee_name || 'the employee'} towards "${summary?.title ?? ''}".`);
    setShowForm(true);
  };

  // Lock the ONE-TIME deduction (its own Submit button) — this fixes the net
  // payable before any payment. Once locked it can't be edited; the "+ Add
  // Payment" button in the Payment History header then becomes available.
  const submitDeductions = async () => {
    if (claimId == null || !summary) return;
    for (const d of deductions) {
      const amt = Number(d.amount) || 0;
      if (amt > 0 && !d.reason.trim()) { toast.warning('Deduction reason required', 'Every deduction needs a reason.'); return; }
    }
    for (const a of additions) {
      const amt = Number(a.amount) || 0;
      if (amt > 0 && !a.reason.trim()) { toast.warning('Addition reason required', 'Every addition needs a reason.'); return; }
      if (amt > 100000) { toast.warning('Addition too high', 'A single addition cannot exceed ₹1,00,000.'); return; }
    }
    if (sanctioned <= 0) { toast.warning('Deductions too high', 'Deductions cannot exceed the claimed amount plus additions — net payable must be greater than zero.'); return; }
    setSaving(true);
    try {
      const { data: r } = await api.post(`${basePath}/${claimId}/set-deductions`, {
        deductions: deductions.filter(d => (Number(d.amount) || 0) > 0).map(d => ({ amount: Number(d.amount), reason: d.reason })),
        additions: additions.filter(a => (Number(a.amount) || 0) > 0).map(a => ({ amount: Number(a.amount), reason: a.reason })),
      });
      toast.success('Deduction locked', r?.message ?? 'The net payable is fixed. Use “+ Add Payment” to disburse.');
      const s = (await api.get<Summary>(`${basePath}/${claimId}/settlement`)).data;
      setSummary(s);
      const rem = s.remaining_amount ?? s.sanctioned_amount ?? 0;
      setAmount(String(rem));
      setNote(`Paid ${inr(rem)} to ${s.employee_name || 'the employee'} towards "${s.title}".`);
    } catch (e: any) {
      toast.error('Could not lock deduction', e?.response?.data?.message ?? 'Please try again.');
    } finally { setSaving(false); }
  };

  // Validate the adjustments (HR only), then open the approve-confirmation dialog.
  const requestApprove = () => {
    if (!summary) return;
    if (!managerReview) {
      for (const d of deductions) {
        const amt = Number(d.amount) || 0;
        if (amt > 0 && !d.reason.trim()) { toast.warning('Deduction reason required', 'Every deduction needs a reason.'); return; }
      }
      for (const a of additions) {
        const amt = Number(a.amount) || 0;
        if (amt > 0 && !a.reason.trim()) { toast.warning('Addition reason required', 'Every addition needs a reason.'); return; }
        if (amt > 100000) { toast.warning('Addition too high', 'A single addition cannot exceed ₹1,00,000.'); return; }
      }
      if (sanctioned <= 0) { toast.warning('Deductions too high', 'Net payable must be greater than zero.'); return; }
    }
    setConfirmKind('approve');
  };

  // Approve: manager stage just forwards to HR (no adjustments); HR stage locks
  // the adjustments while approving.
  const reviewApprove = async () => {
    if (claimId == null || !summary) return;
    setSaving(true);
    try {
      if (managerReview) {
        await api.post(`${basePath}/${claimId}/manager-approve`);
        toast.success('Request approved', 'Approved and forwarded to HR / Finance for settlement.');
        onDone();
        onClose();
      } else {
        await api.post(`${basePath}/${claimId}/hr-approve`, {
          deductions: deductions.filter(d => (Number(d.amount) || 0) > 0).map(d => ({ amount: Number(d.amount), reason: d.reason })),
          additions: additions.filter(a => (Number(a.amount) || 0) > 0).map(a => ({ amount: Number(a.amount), reason: a.reason })),
        });
        toast.success(isAdvance ? 'Advance approved' : 'Claim approved', `The ${noun} is approved — record the payment below to disburse.`);
        // Stay in the SAME modal and flip to payment mode instead of forcing a
        // reopen: clear the confirm dialog, refresh the (now-approved) summary,
        // and let HR record the payout right here.
        onDone();
        setConfirmKind(null);
        setApprovedInline(true);
        setSummary((await api.get<Summary>(`${basePath}/${claimId}/settlement`)).data);
      }
    } catch (e: any) {
      toast.error('Could not approve', e?.response?.data?.message ?? 'Please try again.');
    } finally { setSaving(false); }
  };

  const reviewReject = async () => {
    if (claimId == null) return;
    if (!rejectReason.trim()) { toast.warning('Reason required', `A reason is required to reject this ${noun}.`); return; }
    setSaving(true);
    try {
      const action = managerReview ? 'manager-reject' : 'hr-reject';
      await api.post(`${basePath}/${claimId}/${action}`, { comment: rejectReason.trim() });
      toast.success(isAdvance ? 'Advance rejected' : 'Claim rejected', `The ${noun} has been rejected.`);
      onDone();
      onClose();
    } catch (e: any) {
      toast.error('Could not reject', e?.response?.data?.message ?? 'Please try again.');
    } finally { setSaving(false); }
  };

  // Sync one payment to Zoho Books (local status toggle for now).
  const syncZoho = async (paymentId: number) => {
    if (claimId == null) return;
    setSyncingId(paymentId);
    try {
      const { data: r } = await api.post(`${basePath}/payments/${paymentId}/sync-zoho`);
      toast.success('Synced to Zoho', r?.message ?? 'Payment marked as synced to Zoho Books.');
      const s = (await api.get<Summary>(`${basePath}/${claimId}/settlement`)).data;
      setSummary(s);
    } catch (e: any) {
      toast.error('Sync failed', e?.response?.data?.message ?? 'Could not sync this payment to Zoho Books.');
    } finally { setSyncingId(null); }
  };

  // Sync every ticked (un-synced) payment to Zoho Books — one distinct Zoho
  // entry per payment — so HR doesn't click "Sync to Zoho" row by row (QA #129).
  const syncZohoBulk = async (ids: number[]) => {
    if (claimId == null || ids.length === 0 || bulkSyncing) return;
    setBulkSyncing(true);
    let ok = 0; let fail = 0;
    // Sequential so each becomes its own Zoho expense and we don't hammer the API.
    for (const id of ids) {
      try { await api.post(`${basePath}/payments/${id}/sync-zoho`); ok++; }
      catch { fail++; }
    }
    try {
      const s = (await api.get<Summary>(`${basePath}/${claimId}/settlement`)).data;
      setSummary(s);
    } catch { /* keep current view on refetch failure */ }
    setSelectedZoho(new Set());
    setBulkSyncing(false);
    if (fail === 0) toast.success('Synced to Zoho', `${ok} payment${ok === 1 ? '' : 's'} synced to Zoho Books.`);
    else toast.warning('Partially synced', `${ok} synced, ${fail} failed — retry the remaining rows.`);
  };

  const submit = async () => {
    if (claimId == null) return;
    // Re-entry guard — the button is disabled while saving, but this blocks a
    // fast double-click that could fire before the disabled state paints, so a
    // payment can never be recorded twice (QA #128).
    if (saving) return;
    // Inline validation — mark the offending fields red instead of a toast.
    // Category + Expense Type only apply to expense claims, not advance payouts.
    const invalid = (!isAdvance && (!categoryId || !expenseType))
      || !paymentType || !proofFile
      || !note.trim() || amountNum <= 0 || amountNum > remaining + 0.005;
    if (invalid) { setShowErrors(true); return; }
    setSaving(true);
    try {
      const fd = new FormData();
      if (firstPayment) {
        deductions.filter(d => (Number(d.amount) || 0) > 0).forEach((d, i) => {
          fd.append(`deductions[${i}][amount]`, String(Number(d.amount)));
          fd.append(`deductions[${i}][reason]`, d.reason);
        });
        additions.filter(a => (Number(a.amount) || 0) > 0).forEach((a, i) => {
          fd.append(`additions[${i}][amount]`, String(Number(a.amount)));
          fd.append(`additions[${i}][reason]`, a.reason);
        });
      }
      fd.append('amount', String(amountNum));
      if (!isAdvance) {
        if (categoryId) fd.append('category_id', categoryId);
        fd.append('expense_type', expenseType);
      }
      fd.append('payment_type', paymentType);
      if (note) fd.append('note', note);
      if (proofFile) fd.append('proof', proofFile);
      const { data: r } = await api.post(`${basePath}/${claimId}/settle`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      toast.success('Payment recorded', r?.message ?? 'The settlement was recorded.');
      onDone();
      // Close the Add-Payment popup and refresh the overview so the new payment
      // shows in the history; keep the main modal open.
      setShowForm(false);
      const s = (await api.get<Summary>(`${basePath}/${claimId}/settlement`)).data;
      setSummary(s);
    } catch (e: any) {
      toast.error('Could not record payment', e?.response?.data?.message ?? 'Please try again.');
    } finally { setSaving(false); }
  };

  /* ── Employee "Settlement" (company advance) ─────────────────────────── */
  // Only for a fully-paid COMPANY advance. The advance amount is the sanctioned
  // (paid) figure; the usage rows' total drives equal / minimum / maximum.
  const isCompanyAdvance = isAdvance && (summary?.used_for === 'company');
  const advancePaidFully = (summary?.settlement_status ?? 'unpaid') === 'paid';
  // Settlement is incremental: bills accumulate across saves; the advance is
  // only LOCKED once finalised. `alreadySettled` = finalised (read-only).
  const alreadySettled = !!summary?.employee_settled_at;
  // Settlement approval gate: a finalised settlement waits for branch/HR
  // approval before the return / reimburse / close is unlocked.
  const settleApprovalStatus = summary?.settle_approval_status ?? null;
  const settlePendingApproval = alreadySettled && settleApprovalStatus === 'pending';
  const settleApproved        = alreadySettled && settleApprovalStatus === 'approved';
  const settleRejected        = settleApprovalStatus === 'rejected'; // reopened (employee_settled_at cleared)
  const existingSettleItems = summary?.settle_items ?? [];
  const existingSettleTotal = +existingSettleItems.reduce((s, it) => s + (Number(it.amount) || 0), 0).toFixed(2);
  const settleInProgress = !alreadySettled && existingSettleItems.length > 0;
  const showSettleSection = isCompanyAdvance && advancePaidFully;
  // Cumulative usage = already-saved bills + the new rows being entered.
  const newSettleTotal = +settleRows.reduce((s, r) => s + (Number(r.amount) || 0), 0).toFixed(2);
  const settleTotal = +(existingSettleTotal + newSettleTotal).toFixed(2);
  const settleBase = summary?.sanctioned_amount ?? summary?.claimed_amount ?? 0;
  const settleDiff = +(settleTotal - settleBase).toFixed(2);
  const settleType: 'equal' | 'minimum' | 'maximum' = settleDiff === 0 ? 'equal' : (settleDiff < 0 ? 'minimum' : 'maximum');
  const settleBalance = Math.abs(settleDiff);
  // Declared type + target ("amount used"): from the persisted row (in-progress)
  // or the in-memory choice (a fresh settlement). For 'equal' the target is the
  // advance itself. Finalising requires bills to total the target exactly.
  const effectiveType: '' | 'equal' | 'minimum' | 'maximum' = (summary?.settle_declared_type as any) || settleChosen;
  const settleTarget2 = summary?.settle_target_amount != null
    ? summary.settle_target_amount
    : (settleChosen === 'equal' ? settleBase : (Number(settleTarget) || 0));
  const settleGoal = settleTarget2 > 0 ? settleTarget2 : settleBase;
  const targetMet = settleGoal > 0 && Math.abs(settleTotal - settleGoal) <= 0.005;
  const overTarget = settleTotal > settleGoal + 0.005;
  // The SAVED bills already cover the full used amount → no more rows to add;
  // the form becomes read-only + the type-specific close action.
  const settleSavedMet = settleGoal > 0 && Math.abs(existingSettleTotal - settleGoal) <= 0.005;
  // How much of the target is still un-itemised (drives the KPI + progress bar).
  const settlePending = alreadySettled ? 0 : +Math.max(0, settleGoal - settleTotal).toFixed(2);
  const settleDone = +(settleGoal - settlePending).toFixed(2);
  const settlePct = settleGoal > 0 ? Math.min(100, Math.round((settleDone / settleGoal) * 100)) : (alreadySettled ? 100 : 0);
  const TYPE_LABEL: Record<'equal' | 'minimum' | 'maximum', string> = {
    equal: 'Equal — used exactly the advance',
    minimum: 'Minimum — used less (return balance)',
    maximum: 'Maximum — used more (reimburse balance)',
  };

  const setSettleRow = (i: number, patch: Partial<{ amount: string; reason: string; method: string; proof: File | null }>) =>
    setSettleRows(rs => rs.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  const addSettleRow = () => setSettleRows(rs => [...rs, { amount: '', reason: '', method: '', proof: null }]);
  const removeSettleRow = (i: number) => setSettleRows(rs => rs.length > 1 ? rs.filter((_, idx) => idx !== i) : rs);

  // A row is "touched" once any field is filled; it's "complete" only when all
  // fields are. Empty rows are ignored so a stray blank row doesn't block saving.
  const rowTouched = (r: { amount: string; reason: string; method: string; proof: File | null }) => Number(r.amount) > 0 || !!r.reason.trim() || !!r.method || !!r.proof;
  const rowComplete = (r: { amount: string; reason: string; method: string; proof: File | null }) => Number(r.amount) > 0 && !!r.reason.trim() && !!r.method && !!r.proof;

  // finalize=false → "Save bills" (append, advance stays open for more).
  // finalize=true  → "Finalize settlement" (append remaining, then LOCK forever).
  const submitSettle = async (finalize: boolean) => {
    if (claimId == null) return;
    if (settleSaving) return; // guard against double-submit (QA #128)
    const touched = settleRows.filter(rowTouched);
    if (touched.some(r => !rowComplete(r))) { setSettleErr(true); return; }
    if (!finalize && touched.length === 0) { setSettleErr(true); return; }
    if (finalize && touched.length === 0 && existingSettleItems.length === 0) { setSettleErr(true); return; }
    if (overTarget) {
      toast.warning('Exceeds the used amount', `Total used ${inr(settleTotal)} exceeds your claimed / used amount ${inr(settleGoal)}. Reduce a bill.`);
      return;
    }
    if (finalize && !targetMet) {
      toast.warning('Doesn’t total the declared amount', `To finalise, the bills must total ${inr(settleGoal)}. Currently ${inr(settleTotal)}.`);
      return;
    }
    setSettleErr(false);
    setSettleSaving(true);
    try {
      const fd = new FormData();
      touched.forEach((r, i) => {
        fd.append(`items[${i}][amount]`, String(Number(r.amount)));
        fd.append(`items[${i}][reason]`, r.reason.trim());
        fd.append(`items[${i}][method]`, r.method);
        if (r.proof) fd.append('proofs[]', r.proof);
      });
      if (settleNote.trim()) fd.append('note', settleNote.trim());
      if (finalize) fd.append('finalize', '1');
      // Declared type + target (backend stores these only on the first save).
      if (effectiveType) fd.append('declared_type', effectiveType);
      if (settleGoal > 0) fd.append('target_amount', String(settleGoal));
      const { data: r } = await api.post(`${basePath}/${claimId}/employee-settle`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      toast.success(finalize ? 'Advance settled' : 'Bills saved', r?.message ?? 'Saved.');
      setSettleMode('idle');
      setSettleFinalizeAsk(false);
      setSettleRows([{ amount: '', reason: '', method: '', proof: null }]);
      onDone();
      const s = (await api.get<Summary>(`${basePath}/${claimId}/settlement`)).data;
      setSummary(s);
      // Finalising a reimburse settlement → jump straight into the Expense Claim
      // form (pre-filled + amount-capped) when the host supplies the opener.
      if (finalize && onRaiseReimbursement && s.settle_type === 'reimburse' && (s.settle_balance ?? 0) > 0 && !s.settle_reimbursement) {
        onClose();
        onRaiseReimbursement({ advanceId: Number(claimId), balance: Number(s.settle_balance || 0), advanceNo: s.claim_no || `ADV-${s.id}` });
      }
    } catch (e: any) {
      toast.error(finalize ? 'Could not settle' : 'Could not save', e?.response?.data?.message ?? 'Please try again.');
    } finally { setSettleSaving(false); }
  };

  // Raise a reimbursement Expense Claim for the over-spent balance (reimburse case).
  const raiseReimbursement = async () => {
    if (claimId == null || raising) return;
    setRaising(true);
    try {
      const { data: r } = await api.post(`${basePath}/${claimId}/raise-reimbursement`, {});
      toast.success('Reimbursement raised', r?.message ?? 'A reimbursement expense has been raised.');
      onDone();
      const s = (await api.get<Summary>(`${basePath}/${claimId}/settlement`)).data;
      setSummary(s);
    } catch (e: any) {
      toast.error('Could not raise reimbursement', e?.response?.data?.message ?? 'Please try again.');
    } finally { setRaising(false); }
  };

  // Branch/HR: approve or reject the employee's finalised settlement. Approving
  // unlocks the return/reimburse/close; rejecting reopens it for a re-settle.
  const approveSettle = async () => {
    if (claimId == null || settleApprovSaving) return;
    setSettleApprovSaving(true);
    try {
      const { data: r } = await api.post(`${basePath}/${claimId}/settle-approve`, {});
      toast.success('Settlement approved', r?.message ?? 'The settlement has been approved.');
      onDone();
      setSummary((await api.get<Summary>(`${basePath}/${claimId}/settlement`)).data);
    } catch (e: any) {
      toast.error('Could not approve', e?.response?.data?.message ?? 'Please try again.');
    } finally { setSettleApprovSaving(false); }
  };
  const rejectSettle = async () => {
    if (claimId == null || settleApprovSaving) return;
    const comment = (window.prompt('Reason for rejecting this settlement (the employee will see it):') || '').trim();
    if (!comment) { toast.error('Reason required', 'Add a short reason so the employee can fix the settlement.'); return; }
    setSettleApprovSaving(true);
    try {
      const { data: r } = await api.post(`${basePath}/${claimId}/settle-reject`, { comment });
      toast.success('Settlement rejected', r?.message ?? 'Reopened for the employee to re-settle.');
      onDone();
      setSummary((await api.get<Summary>(`${basePath}/${claimId}/settlement`)).data);
    } catch (e: any) {
      toast.error('Could not reject', e?.response?.data?.message ?? 'Please try again.');
    } finally { setSettleApprovSaving(false); }
  };

  // Branch admin / HR confirms (or rejects) a single employee return payment.
  // The return only closes once every covering payment is approved.
  const approveReturnPayment = async (index: number) => {
    if (claimId == null || returnPayBusy !== null) return;
    setReturnPayBusy(index);
    try {
      const { data: r } = await api.post(`${basePath}/${claimId}/return-payments/${index}/approve`, {});
      toast.success('Payment approved', r?.message ?? 'Return payment confirmed.');
      onDone();
      setSummary((await api.get<Summary>(`${basePath}/${claimId}/settlement`)).data);
    } catch (e: any) {
      toast.error('Could not approve', e?.response?.data?.message ?? 'Please try again.');
    } finally { setReturnPayBusy(null); }
  };
  const rejectReturnPayment = async (index: number) => {
    if (claimId == null || returnPayBusy !== null) return;
    const reason = (window.prompt('Reason for rejecting this return payment (optional — the employee will see it):') || '').trim();
    setReturnPayBusy(index);
    try {
      const { data: r } = await api.post(`${basePath}/${claimId}/return-payments/${index}/reject`, reason ? { reason } : {});
      toast.info('Payment rejected', r?.message ?? 'The employee can record it again.');
      onDone();
      setSummary((await api.get<Summary>(`${basePath}/${claimId}/settlement`)).data);
    } catch (e: any) {
      toast.error('Could not reject', e?.response?.data?.message ?? 'Please try again.');
    } finally { setReturnPayBusy(null); }
  };

  // Prefer opening the real Expense Claim form (profile) when available;
  // otherwise fall back to the one-click auto-create.
  const raiseOrOpenReimbursement = () => {
    if (onRaiseReimbursement && summary) {
      onRaiseReimbursement({
        advanceId: Number(claimId),
        balance: Number(summary.settle_balance || 0),
        advanceNo: summary.claim_no || `ADV-${summary.id}`,
      });
    } else {
      raiseReimbursement();
    }
  };

  // Remaining still to be returned (balance − ledger total).
  const returnRemaining = summary?.settle_return_remaining ?? (summary?.settle_balance ?? 0);
  // Payroll schedule helpers (min = next month; type math for months + end date).
  const nextMonthDay = (() => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + 1); return d.toISOString().slice(0, 10); })();
  const recStep = returnRecType === 'bimonthly' ? 2 : 1;
  const recMonthlyNum = Number(returnRecMonthly) || 0;
  const recMonths = returnRecType === 'lumpsum' ? 1 : (Number(returnRecMonths) || 0);
  // Bidirectional helpers — editing monthly recomputes months and vice-versa.
  const setMonthlyFromInput = (raw: string) => {
    let v = raw; if ((Number(v) || 0) > returnRemaining) v = String(returnRemaining);
    setReturnRecMonthly(v);
    const n = Number(v) || 0;
    setReturnRecMonths(n > 0 ? String(Math.max(1, Math.ceil(returnRemaining / n))) : '');
    const cap = summary?.emi_available != null ? Math.floor(summary.emi_available) : 0;
    if (cap > 0 && n > cap) toast.warning('Over the EMI headroom', `Available EMI headroom is ${inr(cap)} (70% of salary − ongoing EMIs). Add more cycles.`);
  };
  const setMonthsFromInput = (raw: string) => {
    const m = Math.max(0, Math.floor(Number(raw) || 0));
    setReturnRecMonths(raw === '' ? '' : String(m));
    const per = m > 0 ? Math.ceil((returnRemaining / m) * 100) / 100 : 0;
    setReturnRecMonthly(per ? String(per) : '');
    const cap = summary?.emi_available != null ? Math.floor(summary.emi_available) : 0;
    if (cap > 0 && per > cap) toast.warning('Over the EMI headroom', `Available EMI headroom is ${inr(cap)} (70% of salary − ongoing EMIs) — increase the cycles.`);
  };
  const recEndLabel = (() => {
    if (!returnRecStart || recMonths < 1) return '—';
    const [y, m] = returnRecStart.split('-').map(Number);
    const d = new Date(y, (m - 1) + (recMonths - 1) * recStep, 1);
    return d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
  })();
  const empSalary = summary?.employee_monthly_salary ?? null;
  const singleLumpOk = empSalary == null || empSalary >= returnRemaining - 0.005;
  // Per-cycle payroll deduction is capped by the remaining EMI headroom
  // (70% of salary − the employee's other ongoing advance EMIs).
  const returnEmiCap = summary?.emi_available != null ? Math.floor(summary.emi_available) : 0;
  const returnPerCycleOver = returnEmiCap > 0 && recMonthlyNum > returnEmiCap;
  // ≤120-cycle tenure guard (mirrors the Advance Request form). If the monthly
  // amount is so low the return needs >120 cycles, block and tell them to raise
  // it; if even the full EMI headroom can't clear it within 120 cycles, it
  // can't be scheduled via payroll at all (return it directly instead).
  const RET_MAX_MONTHS = 120;
  const returnMinMonthly = returnRemaining > 0 ? Math.ceil(returnRemaining / RET_MAX_MONTHS) : 0;
  const returnCannotSchedule = returnEmiCap > 0 && returnMinMonthly > returnEmiCap;
  const returnTenureExceeds = (returnRecType === 'emi' || returnRecType === 'bimonthly')
    && recMonthlyNum > 0 && recMonths > RET_MAX_MONTHS;
  // Row 2 (monthly / months / end date) stays locked until start + type are set.
  const returnRow2Locked = !returnRecStart || (returnRecType !== 'emi' && returnRecType !== 'bimonthly');
  const toastRow2Locked = () => toast.warning('Complete step 1 first', !returnRecType ? 'Select the recovery start and recovery type first.' : !returnRecStart ? 'Select the recovery start month first.' : 'Select the recovery start and recovery type first.');

  // Record one return payment — direct (amount + method + proof, partial ok) or
  // payroll (clears the whole remaining in one entry).
  const submitReturn = async () => {
    if (claimId == null || !returnMode) return;
    if (returnSaving) return; // guard against double-submit (QA #128)
    if (returnMode === 'direct') {
      const amt = Number(returnAmount) || 0;
      if (!returnMethod || !(amt > 0)) { setReturnErr(true); return; }
      if (amt > returnRemaining + 0.005) {
        toast.warning('Over the remaining', `Amount can't exceed the remaining ${inr(returnRemaining)}.`);
        return;
      }
    } else {
      // payroll — validate the recovery schedule
      if (!returnRecStart || !returnRecType) { setReturnErr(true); return; }
      if (returnRecType === 'lumpsum' && !singleLumpOk) {
        toast.warning('Salary too low', `Single lump needs a monthly salary of at least ${inr(returnRemaining)}. Choose EMI or Bi-monthly.`);
        return;
      }
      if (returnRecType !== 'lumpsum' && !(recMonthlyNum > 0)) { setReturnErr(true); return; }
      if (returnRecType !== 'lumpsum' && returnPerCycleOver) {
        toast.warning('Over the EMI headroom', `Available EMI headroom is ${inr(returnEmiCap)} (70% of salary − ongoing EMIs).`);
        return;
      }
      if (returnRecType !== 'lumpsum' && returnCannotSchedule) {
        toast.warning('Can’t schedule via payroll', `${inr(returnRemaining)} can’t be recovered within ${RET_MAX_MONTHS} ${returnRecType === 'bimonthly' ? 'cycles' : 'months'} at the EMI headroom (${inr(returnEmiCap)}). Return it directly instead.`);
        return;
      }
      if (returnRecType !== 'lumpsum' && returnTenureExceeds) {
        toast.warning('Too many instalments', `At ${inr(recMonthlyNum)}/${returnRecType === 'bimonthly' ? 'cycle' : 'month'} this needs ${recMonths} — over the ${RET_MAX_MONTHS} limit. Increase the monthly amount (min ${inr(returnMinMonthly)}).`);
        return;
      }
    }
    setReturnErr(false);
    setReturnSaving(true);
    try {
      const fd = new FormData();
      fd.append('mode', returnMode);
      if (returnMode === 'direct') {
        fd.append('amount', String(Number(returnAmount)));
        fd.append('method', returnMethod);
        if (returnProof) fd.append('proof', returnProof);
      } else {
        fd.append('recovery_start', returnRecStart);
        fd.append('recovery_type', returnRecType);
        if (returnRecType !== 'lumpsum') fd.append('monthly', String(recMonthlyNum));
      }
      if (returnNote.trim()) fd.append('note', returnNote.trim());
      const { data: r } = await api.post(`${basePath}/${claimId}/record-return`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      toast.success('Return recorded', r?.message ?? 'The return has been recorded.');
      setReturnOpen(false);
      setReturnMode('');
      setReturnAmount('');
      setReturnMethod('');
      setReturnProof(null);
      setReturnRecStart('');
      setReturnRecType('');
      setReturnRecMonthly('');
      setReturnNote('');
      onDone();
      const s = (await api.get<Summary>(`${basePath}/${claimId}/settlement`)).data;
      setSummary(s);
    } catch (e: any) {
      toast.error('Could not record return', e?.response?.data?.message ?? 'Please try again.');
    } finally { setReturnSaving(false); }
  };

  if (!open) return null;

  return createPortal(
    <div className="esm-backdrop" onMouseDown={onClose}>
      <style>{CSS}</style>
      <div className={`esm-modal ${inReview ? 'esm-modal--fit' : ''} ${managerReview ? 'esm-modal--fit-mgr' : ''}`} onMouseDown={e => e.stopPropagation()} role="dialog" aria-modal="true">
        {/* ── Teal hero header (with embedded claim summary panel) ── */}
        <div className="esm-hero">
          <div className="esm-hero-top">
            <div className="esm-hero-l">
              <span className="esm-hero-ico">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" /><line x1="1" y1="10" x2="23" y2="10" /></svg>
              </span>
              <div>
                <div className="esm-hero-eyebrow">HRMS · EXPENSE MANAGEMENT</div>
                <div className="esm-hero-title">{inReview ? 'Review & Approve' : readOnly ? 'Payment Details' : 'Record Payment'}{summary ? <span className="esm-hero-sub-inline" title={summary.title || ''}> · {summary.title}</span> : ''}</div>
                <div className="esm-hero-sub">{inReview ? (managerReview ? `Review the ${noun}, then approve or reject.` : `Review the ${noun}, set adjustments, then approve or reject.`) : readOnly ? (isAdvance ? 'Payout details for this advance.' : 'Reimbursement details for this expense claim.') : (isAdvance ? 'Settle an approved advance and record the payout.' : 'Settle an approved expense claim and record the reimbursement.')}</div>
              </div>
            </div>
            <button className="esm-x" onClick={onClose} aria-label="Close">✕</button>
          </div>
          {summary && !managerReview && (
            <div className="esm-hpanel">
              <div className="esm-hp"><label>EXPENSE ID</label><div>{summary.claim_no || '—'}</div></div>
              <div className="esm-hp"><label>EMPLOYEE</label><div>{summary.employee_name || '—'}</div></div>
              <div className="esm-hp"><label>CLAIMED AMOUNT</label><div>{inr(claimed)}</div></div>
              <div className="esm-hp"><label>CATEGORY</label><div>{summary.category_name || '—'}</div></div>
              <div className="esm-hp"><label>RAISED DATE</label><div>{fmtDate(summary.expense_date)}</div></div>
              <div className="esm-hp"><label>CURRENCY</label><div>{summary.currency || 'INR'}</div></div>
              {/* Salary-recovery schedule keys (self advance). */}
              {isAdvance && (summary.used_for ?? 'self') !== 'company' && summary.recovery_mode && (() => {
                const rmode = summary.recovery_mode;
                const rlbl = rmode === 'emi' ? 'EMI' : rmode === 'bimonthly' ? 'Bi-Monthly' : 'Single Lump Sum';
                const rstep = rmode === 'bimonthly' ? 2 : 1;
                const rmonths = summary.recovery_months ?? 0;
                const rEnd = (() => {
                  if (!summary.recovery_start) return '—';
                  const d = new Date(summary.recovery_start);
                  const cyc = rmode === 'lumpsum' ? 1 : (rmonths || 1);
                  return new Date(d.getFullYear(), d.getMonth() + (cyc - 1) * rstep, 1).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
                })();
                return (
                  <>
                    <div className="esm-hp"><label>RECOVERY MODE</label><div>{rlbl}</div></div>
                    <div className="esm-hp"><label>RECOVERY START</label><div>{fmtDate(summary.recovery_start)}</div></div>
                    {rmode !== 'lumpsum' && <>
                      <div className="esm-hp"><label>NO. OF {rmode === 'bimonthly' ? 'CYCLES' : 'MONTHS'}</label><div>{rmonths || '—'}</div></div>
                      <div className="esm-hp"><label>{rmode === 'bimonthly' ? 'AMOUNT / CYCLE' : 'MONTHLY EMI'}</label><div>{summary.monthly_emi != null ? inr(summary.monthly_emi) : '—'}</div></div>
                      <div className="esm-hp"><label>END DATE</label><div>{rEnd}</div></div>
                    </>}
                  </>
                );
              })()}
              <div className="esm-hp esm-hp-proof">
                <label>PROOF OF PAYMENT (BY EMPLOYEE)</label>
                {summary.attachments.length === 0 ? (
                  <div className="esm-hp-none">No documents uploaded.</div>
                ) : (
                  <div className="esm-hp-docs">
                    {(showAllProofs ? summary.attachments : summary.attachments.slice(0, 4)).map((a, i) => (
                      <div key={i} className="esm-hp-doc">
                        <i className="ri-file-text-line" />
                        <a className="esm-hp-doc-name" href={tokenUrl(a.url)} target="_blank" rel="noreferrer" title={`View ${a.name}`}>{a.name}</a>
                        <a className="esm-hp-doc-act" href={tokenUrl(a.url)} download={a.name} title={`Download ${a.name}`} aria-label="Download"><i className="ri-download-2-line" /></a>
                      </div>
                    ))}
                    {summary.attachments.length > 4 && (
                      <button type="button" className="esm-hp-doc esm-hp-more" onClick={() => setShowAllProofs(v => !v)}>
                        {showAllProofs ? 'Show less' : `+${summary.attachments.length - 4} more`}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>


        {/* ── Body ── */}
        <div className="esm-body">
          {loading || !summary ? (
            <div className="esm-loading"><i className="ri-loader-4-line ri-spin" /> Loading…</div>
          ) : (
            <>
              {/* KPI strip — hidden in a manager review (everything's in Claim Details). */}
              {!managerReview && (
              <div className={`esm-kpis ${inReview ? 'esm-kpis--4' : ''}`}>
                <div className="esm-kpi esm-kpi-teal">
                  <span className="esm-kpi-ico"><IcoDoc /></span>
                  <div className="esm-kpi-txt">
                    <div className="esm-kpi-lab">CLAIMED AMOUNT</div>
                    <div className="esm-kpi-val" title={inr(claimed)}>{inr(claimed)}</div>
                    <div className="esm-kpi-sub">{isAdvance ? 'Original advance' : 'Original claim'}</div>
                  </div>
                </div>
                <div className="esm-kpi esm-kpi-green">
                  <span className="esm-kpi-ico"><IcoCheck /></span>
                  <div className="esm-kpi-txt">
                    <div className="esm-kpi-lab">{isAdvance ? 'ADVANCE PAID' : 'AMOUNT PAID'}</div>
                    <div className="esm-kpi-val" title={inr(paidSoFar)}>{inr(paidSoFar)}</div>
                    <div className="esm-kpi-sub">{summary.payments.length} {isAdvance ? 'payout' : 'payment'}{summary.payments.length === 1 ? '' : 's'} recorded</div>
                  </div>
                </div>
                {!inReview && (
                <div className="esm-kpi esm-kpi-amber">
                  <span className="esm-kpi-ico"><IcoWallet /></span>
                  <div className="esm-kpi-txt">
                    {showSettleSection ? (
                      <>
                        <div className="esm-kpi-lab">SETTLE AMOUNT PENDING</div>
                        <div className="esm-kpi-val" title={inr(settlePending)}>{inr(settlePending)}</div>
                        <div className="esm-kpi-sub">{alreadySettled ? 'Settled' : 'Pending settle'}</div>
                      </>
                    ) : (
                      <>
                        <div className="esm-kpi-lab">BALANCE AMOUNT</div>
                        <div className="esm-kpi-val" title={inr(remaining)}>{inr(remaining)}</div>
                        <div className="esm-kpi-sub">{fullyPaid ? 'Fully paid' : 'Outstanding'}</div>
                      </>
                    )}
                  </div>
                </div>
                )}
                <div className="esm-kpi esm-kpi-blue">
                  <span className="esm-kpi-ico"><IcoPlus /></span>
                  <div className="esm-kpi-txt">
                    <div className="esm-kpi-lab">TOTAL ADDITIONS</div>
                    <div className="esm-kpi-val" title={inr(firstPayment ? totalAddition : (summary.addition_amount || 0))}>{inr(firstPayment ? totalAddition : (summary.addition_amount || 0))}</div>
                    <div className="esm-kpi-sub">Added to {noun}</div>
                  </div>
                </div>
                <div className="esm-kpi esm-kpi-rose">
                  <span className="esm-kpi-ico"><IcoMinus /></span>
                  <div className="esm-kpi-txt">
                    <div className="esm-kpi-lab">TOTAL DEDUCTED</div>
                    <div className="esm-kpi-val" title={inr(firstPayment ? totalDeduction : (summary.deduction_amount || 0))}>{inr(firstPayment ? totalDeduction : (summary.deduction_amount || 0))}</div>
                    <div className="esm-kpi-sub">Deducted from {noun}</div>
                  </div>
                </div>
              </div>
              )}

              {/* Manager-stage row opened from the HR Expense page — the
                  reporting-manager approval is Inbox-only, so redirect there. */}
              {managerStageRedirect && (
                <div className="esm-sec">
                  <div className="esm-sec-body" style={{ textAlign: 'center', padding: '28px 20px' }}>
                    <div style={{ width: 52, height: 52, borderRadius: '50%', background: '#eef2ff', color: '#3730a3', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
                      <i className="ri-inbox-archive-line" style={{ fontSize: 24 }} />
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 800, color: '#1f2937', marginBottom: 6 }}>Awaiting reporting-manager approval</div>
                    <div style={{ fontSize: 12.5, color: '#6b7280', maxWidth: 440, margin: '0 auto 16px', lineHeight: 1.5 }}>
                      This {noun} is still at the <strong>Reporting Manager</strong> stage, so it can't be actioned here. If you're the reporting manager, approve it from your <strong>Inbox</strong>; once approved it comes back here for the HR / Finance stage and payout.
                    </div>
                    <button type="button" className="esm-btn-approve" style={{ background: 'linear-gradient(135deg,#4F46E5,#7C3AED)' }} onClick={() => { onGoToInbox?.(); onClose(); }}>
                      <i className="ri-inbox-archive-line" style={{ marginRight: 6 }} /> Go to Inbox
                    </button>
                  </div>
                </div>
              )}

              {/* Claim Details — shown in a manager review (the Adjustments &
                  Payment History sections are hidden) so the manager has full
                  context to approve or reject. */}
              {managerReview && !managerStageRedirect && (
                <div className="esm-sec">
                  <div className="esm-sec-hd">
                    <div className="esm-sec-l">
                      <span className="esm-sec-ico"><i className="ri-file-list-3-line" /></span>
                      <div className="esm-sec-tt">
                        <div className="esm-sec-title-row">
                          <span className="esm-sec-tag">Expense</span>
                          <span className="esm-sec-div">|</span>
                          <span className="esm-sec-title">Claim Details</span>
                        </div>
                        <div className="esm-sec-sub">Review the {noun} before approving</div>
                      </div>
                    </div>
                  </div>
                  <div className="esm-sec-body esm-grid12">
                    <div className="esm-ro c3"><label>EXPENSE ID</label><div className="esm-ro-v esm-ro-sm">{summary.claim_no || '—'}</div></div>
                    <div className="esm-ro c3"><label>EMPLOYEE</label><div className="esm-ro-v esm-ro-sm">{summary.employee_name || '—'}</div></div>
                    <div className="esm-ro c3"><label>RAISED DATE</label><div className="esm-ro-v esm-ro-sm">{fmtDate(summary.expense_date)}</div></div>
                    <div className="esm-ro c3"><label>CURRENCY</label><div className="esm-ro-v esm-ro-sm">{summary.currency || 'INR'}</div></div>
                    <div className="esm-ro c3"><label>CATEGORY</label><div className="esm-ro-v esm-ro-sm">{summary.category_name || '—'}</div></div>
                    <div className="esm-ro c3"><label>CLAIMED AMOUNT</label><div className="esm-ro-v">{inr(claimed)}</div></div>
                    <div className="esm-ro c6"><label>DESCRIPTION</label><div className="esm-ro-v esm-ro-sm esm-ro-v--text" title={summary.title || ''}>{summary.title || '—'}</div></div>
                    {/* Vendor / Project are expense-only; an advance has neither. */}
                    <div className={`esm-ro ${isAdvance ? 'c12' : 'c4'}`}><label>PURPOSE</label><div className="esm-ro-v esm-ro-sm esm-ro-v--text" title={summary.purpose || ''}>{summary.purpose || '—'}</div></div>
                    {!isAdvance && <div className="esm-ro c4"><label>SUPPLIER</label><div className="esm-ro-v esm-ro-sm">{summary.vendor || '—'}</div></div>}
                    {!isAdvance && <div className="esm-ro c4"><label>PROJECT</label><div className="esm-ro-v esm-ro-sm">{summary.project || '—'}</div></div>}
                    {/* Salary-recovery schedule — self advance only. */}
                    {isAdvance && (summary.used_for ?? 'self') !== 'company' && summary.recovery_mode && (() => {
                      const rmode = summary.recovery_mode;
                      const rlbl = rmode === 'emi' ? 'EMI' : rmode === 'bimonthly' ? 'Bi-Monthly' : 'Single Lump Sum';
                      const rstep = rmode === 'bimonthly' ? 2 : 1;
                      const rmonths = summary.recovery_months ?? 0;
                      const rEnd = (() => {
                        if (!summary.recovery_start) return '—';
                        const d = new Date(summary.recovery_start);
                        const cyc = rmode === 'lumpsum' ? 1 : (rmonths || 1);
                        return new Date(d.getFullYear(), d.getMonth() + (cyc - 1) * rstep, 1).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
                      })();
                      return (
                        <>
                          <div className="esm-ro c3"><label>RECOVERY MODE</label><div className="esm-ro-v esm-ro-sm">{rlbl}</div></div>
                          <div className="esm-ro c3"><label>RECOVERY START</label><div className="esm-ro-v esm-ro-sm">{fmtDate(summary.recovery_start)}</div></div>
                          {rmode !== 'lumpsum' && <>
                            <div className="esm-ro c3"><label>NO. OF {rmode === 'bimonthly' ? 'CYCLES' : 'MONTHS'}</label><div className="esm-ro-v esm-ro-sm">{rmonths || '—'}</div></div>
                            <div className="esm-ro c3"><label>{rmode === 'bimonthly' ? 'AMOUNT / CYCLE' : 'MONTHLY EMI'}</label><div className="esm-ro-v esm-ro-sm">{summary.monthly_emi != null ? inr(summary.monthly_emi) : '—'}</div></div>
                            <div className="esm-ro c3"><label>END DATE</label><div className="esm-ro-v esm-ro-sm">{rEnd}</div></div>
                          </>}
                        </>
                      );
                    })()}
                    <div className="esm-ro c12">
                      <label>PROOF OF PAYMENT (BY EMPLOYEE)</label>
                      {summary.attachments.length === 0 ? (
                        <div className="esm-hint">No documents were uploaded with this claim.</div>
                      ) : (
                        <div className="esm-docs">
                          {summary.attachments.map((a, i) => (
                            <a key={i} className="esm-doc" href={tokenUrl(a.url)} target="_blank" rel="noreferrer" title={a.name}>
                              <i className="ri-file-text-line" />
                              <span className="esm-doc-name">{a.name}</span>
                              <i className="ri-external-link-line esm-doc-ext" />
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Payment progress — sits above the deductions,
                  shown once the deduction is locked and payments can be recorded. */}
              {!firstPayment && (
                showSettleSection ? (
                  <div className="esm-prog2 esm-prog2--band">
                    <div className="esm-prog2-hd">
                      <span className="esm-prog2-lbl">Settlement Progress</span>
                      <span className="esm-prog2-meta">{inr(settleDone)} of {inr(settleBase)} settled · {inr(settlePending)} pending · {settlePct}%</span>
                    </div>
                    <div className="esm-prog2-track"><div className="esm-prog2-fill" style={{ width: `${settlePct}%` }} /></div>
                  </div>
                ) : (
                  <div className="esm-prog2 esm-prog2--band">
                    <div className="esm-prog2-hd">
                      <span className="esm-prog2-lbl">Payment Progress</span>
                      <span className="esm-prog2-meta">{inr(paidSoFar)} of {inr(sanctioned)} net payable · {payPct}% paid</span>
                    </div>
                    <div className="esm-prog2-track"><div className="esm-prog2-fill" style={{ width: `${payPct}%` }} /></div>
                  </div>
                )
              )}

              {/* Deductions section — hidden in a MANAGER review (they only see the
                  claim + approve/reject; no deduct). Icon header, 2-col body,
                  submit below; editable only until the first payment locks it. */}
              {!managerReview && (
              <div className="esm-sec">
                <div className="esm-sec-hd">
                  <div
                    className="esm-sec-l"
                    style={!firstPayment ? { cursor: 'pointer' } : undefined}
                    onClick={!firstPayment ? () => toast.info('Adjustments locked', `Additions & deductions can only be applied once — they’re locked for this ${noun}.`) : undefined}
                  >
                    <span className="esm-sec-ico"><i className="ri-scissors-cut-line" /></span>
                    <div className="esm-sec-tt">
                      <div className="esm-sec-title-row">
                        <span className="esm-sec-tag">Settlement</span>
                        <span className="esm-sec-div">|</span>
                        <span className="esm-sec-title">Adjustments</span>
                      </div>
                      <div className="esm-sec-sub">{editDeductions ? 'Apply one-time additions / deductions, then submit to lock the net payable' : `Adjustments applied to this ${noun}`}</div>
                    </div>
                  </div>
                  <div className="esm-sec-hd-actions">
                    {!firstPayment && <span className="esm-sec-badge esm-sec-badge--lock" style={{ cursor: 'pointer' }} onClick={() => toast.info('Adjustments locked', `Additions & deductions can only be applied once — they’re locked for this ${noun}.`)}><i className="ri-lock-2-line" /> Locked</span>}
                    <button type="button" className={`esm-sec-chev ${adjOpen ? '' : 'is-collapsed'}`} onClick={() => setAdjOpen(o => !o)} aria-label={adjOpen ? 'Collapse' : 'Expand'}>
                      <i className="ri-arrow-down-s-line" />
                    </button>
                  </div>
                </div>
                {adjOpen && (
                <div className="esm-sec-body">
                  <div className="esm-ded-split">
                    <div className="esm-ded-l">
                      {/* Additions (+) */}
                      <div className="esm-adj esm-adj--add">
                        <div className="esm-ded-hd">
                          <span className="esm-ded-hd-lbl esm-add-lbl">ADDITIONS (+)</span>
                          {editDeductions && <button type="button" className="esm-ded-add esm-add-btn" onClick={addAdd}>+ Add</button>}
                        </div>
                        {editDeductions ? (
                          additions.length === 0 ? (
                            <div className="esm-hint">No additions.</div>
                          ) : (
                            <div className="esm-ded-list">
                              {additions.map((a, i) => (
                                <div className="esm-ded" key={i}>
                                  <div className="esm-ded-amt"><span className="esm-cur">₹</span>
                                    <input className="esm-in" type="number" min={0} max={100000} placeholder="0.00" value={a.amount} onChange={e => setAdd(i, { amount: e.target.value })} />
                                  </div>
                                  <input className="esm-in esm-ded-reason" placeholder="Reason for this addition…" value={a.reason} onChange={e => setAdd(i, { reason: e.target.value })} />
                                  <button type="button" className="esm-ded-x" onClick={() => removeAdd(i)} aria-label="Remove">✕</button>
                                </div>
                              ))}
                            </div>
                          )
                        ) : (summary.additions ?? []).length > 0 ? (
                          <div className="esm-ded-list">
                            {summary.additions.map((a, i) => (
                              <div className="esm-payrow" key={i}><span className="esm-adj-reason" title={a.reason}>{a.reason}</span><span className="is-pos">+ {inr(a.amount)}</span></div>
                            ))}
                          </div>
                        ) : (
                          <div className="esm-hint">No additions applied.</div>
                        )}
                      </div>

                      <div className="esm-vline" />

                      {/* Deductions (−) */}
                      <div className="esm-adj esm-adj--ded">
                        <div className="esm-ded-hd">
                          <span className="esm-ded-hd-lbl">DEDUCTIONS (−)</span>
                          {editDeductions && <button type="button" className="esm-ded-add" onClick={addDed}>+ Add</button>}
                        </div>
                        {editDeductions ? (
                          deductions.length === 0 ? (
                            <div className="esm-hint">No deductions.</div>
                          ) : (
                            <div className="esm-ded-list">
                              {deductions.map((d, i) => (
                                <div className="esm-ded" key={i}>
                                  <div className="esm-ded-amt"><span className="esm-cur">₹</span>
                                    <input className="esm-in" type="number" min={0} placeholder="0.00" value={d.amount} onChange={e => setDed(i, { amount: e.target.value })} />
                                  </div>
                                  <input className="esm-in esm-ded-reason" placeholder="Reason for this deduction…" value={d.reason} onChange={e => setDed(i, { reason: e.target.value })} />
                                  <button type="button" className="esm-ded-x" onClick={() => removeDed(i)} aria-label="Remove">✕</button>
                                </div>
                              ))}
                            </div>
                          )
                        ) : (summary.deductions ?? []).length > 0 ? (
                          <div className="esm-ded-list">
                            {summary.deductions.map((d, i) => (
                              <div className="esm-payrow" key={i}><span className="esm-adj-reason" title={d.reason}>{d.reason}</span><span className="is-neg">− {inr(d.amount)}</span></div>
                            ))}
                          </div>
                        ) : (
                          <div className="esm-hint">No deductions applied.</div>
                        )}
                      </div>
                    </div>

                    <div className="esm-ded-r">
                      <div className="esm-sumbox">
                        <div className="esm-sumrow"><span>Claimed Amount</span><span>{inr(claimed)}</span></div>
                        <div className="esm-sumrow"><span>Additions (+)</span><span className={(editDeductions ? totalAddition : (summary.addition_amount || 0)) > 0 ? 'is-pos' : ''}>+ {inr(editDeductions ? totalAddition : (summary.addition_amount || 0))}</span></div>
                        <div className="esm-sumrow"><span>Deductions (−)</span><span className={(editDeductions ? totalDeduction : (summary.deduction_amount || 0)) > 0 ? 'is-neg' : ''}>− {inr(editDeductions ? totalDeduction : (summary.deduction_amount || 0))}</span></div>
                        <div className={`esm-sumrow is-grand ${sanctioned <= 0 ? 'is-bad' : ''}`}><span>Net Payable (Sanctioned)</span><span>{inr(sanctioned)}</span></div>
                      </div>
                    </div>
                  </div>

                  {editDeductions && !inReview && (
                    <div className="esm-sec-actions">
                      <span className="esm-sec-actions-hint">{sanctioned <= 0 ? 'Net payable must be greater than zero — reduce the deductions.' : 'Once submitted, the deduction is locked and can’t be edited.'}</span>
                      <button type="button" className="esm-btn-submit" onClick={submitDeductions} disabled={saving || !summary || sanctioned <= 0}>{saving ? 'Submitting…' : 'Submit'}</button>
                    </div>
                  )}
                </div>
                )}
              </div>
              )}

              {/* Payment History + Add Payment — hidden during review, revealed
                  once HR approves inline so they can disburse in the same modal. */}
              {!inReview && (
              <div className="esm-sec">
                <div className="esm-sec-hd">
                  <div className="esm-sec-l">
                    <span className="esm-sec-ico"><i className="ri-history-line" /></span>
                    <div className="esm-sec-tt">
                      <div className="esm-sec-title-row">
                        <span className="esm-sec-tag">Payment</span>
                        <span className="esm-sec-div">|</span>
                        <span className="esm-sec-title">{isAdvance ? 'Advance Paid' : 'Payment History'}</span>
                      </div>
                      <div className="esm-sec-sub">{isAdvance ? 'Recorded payouts against this advance' : 'Recorded reimbursements against this claim'}</div>
                    </div>
                  </div>
                  <div className="esm-sec-hd-actions">
                    <span className="esm-sec-badge">{summary.payments.length} transaction{summary.payments.length === 1 ? '' : 's'}</span>
                    {/* Bulk Zoho sync — appears when there are un-synced rows.
                        Syncs every ticked payment as its own Zoho entry (QA #129). */}
                    {showZohoSelect && (
                      <button
                        type="button"
                        className="esm-sec-btn"
                        onClick={() => syncZohoBulk(zohoSelectedIds)}
                        disabled={bulkSyncing || zohoSelectedIds.length === 0}
                        title={zohoSelectedIds.length === 0 ? 'Tick one or more un-synced payments' : 'Sync the selected payments to Zoho Books'}
                      >
                        <i className="ri-refresh-line" /> {bulkSyncing ? 'Syncing…' : `Sync selected to Zoho${zohoSelectedIds.length ? ` (${zohoSelectedIds.length})` : ''}`}
                      </button>
                    )}
                    {!readOnly && (
                      <button
                        type="button"
                        className="esm-sec-btn"
                        onClick={openPaymentForm}
                        disabled={firstPayment || fullyPaid}
                        title={firstPayment ? 'Submit the deduction first' : fullyPaid ? 'This claim is fully paid' : 'Record a payment'}
                      >
                        + Add Payment
                      </button>
                    )}
                    <button type="button" className={`esm-sec-chev ${payOpen ? '' : 'is-collapsed'}`} onClick={() => setPayOpen(o => !o)} aria-label={payOpen ? 'Collapse' : 'Expand'}>
                      <i className="ri-arrow-down-s-line" />
                    </button>
                  </div>
                </div>
                {payOpen && (
                <div className="esm-sec-body">
                  {summary.payments.length === 0 ? (
                    <div className="esm-hint">{readOnly ? `No payments recorded yet against this ${noun}.` : 'No payments recorded yet. Use “+ Add Payment” to record one.'}</div>
                  ) : (
                    <div className="esm-tblwrap">
                      <table className="esm-tbl">
                        <thead>
                          <tr>
                            {showZohoSelect && (
                              <th style={{ width: 34, textAlign: 'center' }}>
                                <input
                                  type="checkbox"
                                  checked={zohoAllSelected}
                                  onChange={toggleAllZoho}
                                  disabled={bulkSyncing}
                                  title="Select all un-synced payments"
                                  aria-label="Select all un-synced payments"
                                />
                              </th>
                            )}
                            <th>SR NO</th><th>AMOUNT PAID</th><th>METHOD</th>{!isAdvance && <th>EXPENSE TYPE</th>}<th>PROOF</th><th>PAID BY</th><th>DATE</th>{!isAdvance && <th>ZOHO BOOK STATUS</th>}{!readOnly && !isAdvance && <th>ACTION</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {summary.payments.map((p, i) => {
                            const synced = (p.zoho_status || 'not_synced') === 'synced';
                            return (
                            <tr key={p.id}>
                              {showZohoSelect && (
                                <td style={{ textAlign: 'center' }}>
                                  {synced ? (
                                    <span className="esm-muted">—</span>
                                  ) : (
                                    <input
                                      type="checkbox"
                                      checked={selectedZoho.has(p.id)}
                                      onChange={() => toggleZoho(p.id)}
                                      disabled={bulkSyncing}
                                      aria-label={`Select payment ${i + 1} for Zoho sync`}
                                    />
                                  )}
                                </td>
                              )}
                              <td>{i + 1}</td>
                              <td className="esm-tbl-amt">{inr(p.amount)}</td>
                              <td>{p.payment_type || '—'}</td>
                              {!isAdvance && <td>{p.expense_type || '—'}</td>}
                              <td>
                                {p.proof_url ? (
                                  <a className="esm-tbl-link" href={tokenUrl(p.proof_url)} target="_blank" rel="noreferrer" title={p.proof_name || 'Proof'}>
                                    <i className="ri-attachment-2" /> {p.proof_name || 'View'}
                                  </a>
                                ) : '—'}
                              </td>
                              <td>{p.paid_by_name || '—'}</td>
                              <td>{fmtDate(p.paid_at)}</td>
                              {!isAdvance && (
                              <td>
                                <span className={`esm-zpill ${synced ? 'is-synced' : 'is-unsynced'}`}>
                                  <i className={synced ? 'ri-checkbox-circle-line' : 'ri-time-line'} /> {synced ? 'Synced' : 'Not Synced'}
                                </span>
                              </td>
                              )}
                              {!readOnly && !isAdvance && (
                                <td>
                                  {synced ? (
                                    p.zoho_expense_url ? (
                                      <a className="esm-zbtn esm-zbtn--view" href={p.zoho_expense_url} target="_blank" rel="noreferrer">
                                        <i className="ri-external-link-line" /> View in Zoho
                                      </a>
                                    ) : (
                                      <span className="esm-muted">—</span>
                                    )
                                  ) : (
                                    <button type="button" className="esm-zbtn" onClick={() => syncZoho(p.id)} disabled={syncingId === p.id || bulkSyncing}>
                                      <i className="ri-refresh-line" /> {syncingId === p.id ? 'Syncing…' : 'Sync to Zoho'}
                                    </button>
                                  )}
                                </td>
                              )}
                            </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
                )}
              </div>
              )}

              {/* ── Recovery Schedule (self advance) — collapsible; below Advance Paid.
                  Header shows only the pending amount + next EMI; the full plan +
                  installments live in the body. ── */}
              {!managerReview && isAdvance && (summary.used_for ?? 'self') !== 'company' && summary?.recovery_mode && (() => {
                const rmode = summary.recovery_mode;
                const rlbl = rmode === 'emi' ? 'EMI' : rmode === 'bimonthly' ? 'Bi-Monthly' : 'Single Lump Sum';
                const rstep = rmode === 'bimonthly' ? 2 : 1;
                const rmonths = summary.recovery_months ?? 0;
                const emi = summary.monthly_emi ?? 0;
                // Recover only what was actually paid — the sanctioned (net) amount
                // after payout adjustments — not the originally-claimed amount.
                const total = summary.sanctioned_amount ?? summary.claimed_amount ?? 0;
                const n = rmode === 'lumpsum' ? 1 : (rmonths || 1);
                const startStr = summary.recovery_start || '';
                // What payroll has actually recovered so far → drives status.
                const recovered = summary.recovery_recovered ?? 0;
                const pending = +Math.max(0, total - recovered).toFixed(2);
                // Actual amount payroll cut in each cycle, keyed "YYYY-M" from the
                // ledger — this is what the RECOVERED column shows per row (it can
                // differ from the scheduled EMI when arrears carry forward).
                const ledgerByMonth: Record<string, number> = {};
                (summary.recovery_ledger ?? []).forEach(l => {
                  const key = `${l.year}-${l.month}`;
                  ledgerByMonth[key] = (ledgerByMonth[key] ?? 0) + l.amount;
                });
                const instAmt = (k: number) => rmode === 'lumpsum' ? total : (k === n - 1 ? +(total - emi * (n - 1)).toFixed(2) : emi);
                // Per-instalment status by walking the cumulative recovered total.
                const instStatus = (k: number): 'Recovered' | 'Partial' | 'Pending' => {
                  let cum = 0; for (let i = 0; i <= k; i++) cum += instAmt(i);
                  if (recovered + 0.005 >= cum) return 'Recovered';
                  if (recovered > cum - instAmt(k) + 0.005) return 'Partial';
                  return 'Pending';
                };
                const nextK = Array.from({ length: n }, (_, k) => k).find(k => instStatus(k) !== 'Recovered');
                const nextAmt = nextK == null ? 0 : instAmt(nextK);
                const nextDate = (() => {
                  if (pending <= 0 || nextK == null || !startStr) return pending <= 0 ? 'Fully recovered' : '—';
                  const [yy, mm] = startStr.split('-').map(Number);
                  return new Date(yy, (mm - 1) + nextK * rstep, 1).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
                })();
                const rEnd = (() => {
                  if (!startStr) return '—';
                  const d = new Date(startStr);
                  return new Date(d.getFullYear(), d.getMonth() + (n - 1) * rstep, 1).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
                })();
                const pill = (t: string, bg: string, fg: string) => <span style={{ display: 'inline-block', padding: '2px 9px', borderRadius: 999, background: bg, color: fg, fontWeight: 700, fontSize: 10.5 }}>{t}</span>;
                return (
                  <div className="esm-sec">
                    <div className="esm-sec-hd">
                      <div className="esm-sec-l">
                        <span className="esm-sec-ico"><i className="ri-calendar-todo-line" /></span>
                        <div className="esm-sec-tt">
                          <div className="esm-sec-title-row">
                            <span className="esm-sec-tag">Settlement</span>
                            <span className="esm-sec-div">|</span>
                            <span className="esm-sec-title">Recovery Schedule</span>
                          </div>
                          <div className="esm-sec-sub">How this advance is recovered from salary</div>
                        </div>
                      </div>
                      <div className="esm-sec-hd-actions">
                        <span className="esm-recap"><span className="esm-recap-k">Pending</span> {inr(pending)}<span className="esm-recap-dot">•</span>{pending > 0 ? (<><span className="esm-recap-k">Next EMI</span> {inr(nextAmt)} · {nextDate}</>) : (<span className="esm-recap-k" style={{ color: '#15803d' }}>Fully recovered</span>)}</span>
                        <button type="button" className={`esm-sec-chev ${recoveryOpen ? '' : 'is-collapsed'}`} onClick={() => setRecoveryOpen(o => !o)} aria-label={recoveryOpen ? 'Collapse' : 'Expand'}>
                          <i className="ri-arrow-down-s-line" />
                        </button>
                      </div>
                    </div>
                    {recoveryOpen && (
                    <div className="esm-sec-body">
                      {advancePaidFully && startStr ? (
                        <>
                          <div className="esm-tblwrap">
                            <table className="esm-tbl">
                              <thead><tr><th>SR NO</th><th>AMOUNT</th><th>{rmode === 'bimonthly' ? 'CYCLE' : 'MONTH'}</th><th>RECOVERED</th><th>STATUS</th></tr></thead>
                              <tbody>
                                {Array.from({ length: n }, (_, k) => {
                                  const amt = instAmt(k);
                                  const [y, m] = startStr.split('-').map(Number);
                                  const d = new Date(y, (m - 1) + k * rstep, 1);
                                  const st = instStatus(k);
                                  const recAmt = ledgerByMonth[`${d.getFullYear()}-${d.getMonth() + 1}`] ?? 0;
                                  return (
                                    <tr key={k}>
                                      <td>{k + 1}</td>
                                      <td className="esm-tbl-amt">{inr(amt)}</td>
                                      <td>{d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}{k === nextK ? <span className="esm-muted"> · next</span> : null}</td>
                                      <td className="esm-tbl-amt">{recAmt > 0 ? <span style={{ color: '#15803d', fontWeight: 700 }}>{inr(recAmt)}</span> : <span className="esm-muted">—</span>}</td>
                                      <td>{st === 'Recovered' ? pill('Recovered', '#dcfce7', '#15803d') : st === 'Partial' ? pill('Partial', '#e0e7ff', '#3730a3') : pill('Pending', '#fef3c7', '#a4661c')}</td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                          <span className="esm-muted" style={{ marginTop: 6, display: 'inline-block' }}>Deducted from payroll each cycle — status updates when payroll runs.</span>
                        </>
                      ) : (
                        <div className="esm-hint">Recovery instalments appear once the advance is paid out.</div>
                      )}
                    </div>
                    )}
                  </div>
                );
              })()}

              {/* ── Settlement (employee, company advance) ── */}
              {showSettleSection && (
              <div className="esm-sec">
                <div className="esm-sec-hd">
                  <div className="esm-sec-l">
                    <span className="esm-sec-ico"><i className="ri-check-double-line" /></span>
                    <div className="esm-sec-tt">
                      <div className="esm-sec-title-row">
                        <span className="esm-sec-tag">Settlement</span>
                        <span className="esm-sec-div">|</span>
                        <span className="esm-sec-title">Settle Advance</span>
                      </div>
                      <div className="esm-sec-sub">Record where the company advance was used — one row per bill</div>
                    </div>
                  </div>
                  <div className="esm-sec-hd-actions">
                    {allowSettle && settleInProgress && (
                      <button type="button" className="esm-sec-btn esm-sec-btn--sm" onClick={() => setSettleMode('form')}><i className="ri-add-line" /> Add more payment</button>
                    )}
                    {alreadySettled && <span className="esm-sec-badge esm-sec-badge--lock" style={{ background: '#d6f4e3', color: '#108548', borderColor: '#a7e3c2' }}><i className="ri-checkbox-circle-line" /> Settled</span>}
                    {settleInProgress && <span className="esm-sec-badge esm-sec-badge--lock" style={{ background: '#fef3c7', color: '#a4661c', borderColor: '#fcd996' }}><i className="ri-time-line" /> In progress</span>}
                    <button type="button" className={`esm-sec-chev ${settleOpen ? '' : 'is-collapsed'}`} onClick={() => setSettleOpen(o => !o)} aria-label={settleOpen ? 'Collapse' : 'Expand'}>
                      <i className="ri-arrow-down-s-line" />
                    </button>
                  </div>
                </div>
                {settleOpen && (
                <div className="esm-sec-body">
                  {(alreadySettled || settleInProgress) ? (
                    <>
                      <div className="esm-tblwrap esm-tblwrap--settle">
                        <table className="esm-tbl esm-tbl--settle">
                          <thead><tr><th>SR NO</th><th>AMOUNT</th><th>REASON</th><th>PAYMENT METHOD</th><th>PROOF</th></tr></thead>
                          <tbody>
                            {existingSettleItems.map((it, i) => (
                              <tr key={i}>
                                <td>{i + 1}</td>
                                <td className="esm-tbl-amt">{inr(it.amount)}</td>
                                <td>{it.reason || '—'}</td>
                                <td>{it.method || '—'}</td>
                                <td>{it.proof_url ? <a className="esm-tbl-link" href={tokenUrl(it.proof_url)} target="_blank" rel="noreferrer" title={it.proof_name || 'Proof'}><i className="ri-attachment-2" /> {it.proof_name || 'View'}</a> : '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {alreadySettled && (
                        <div className="esm-sumrow is-grand" style={{ marginTop: 12, borderRadius: 8, padding: '10px 14px', background: summary?.settle_type === 'reimburse' ? '#cffafe' : summary?.settle_type === 'return' ? '#fde8c4' : '#d6f4e3', color: summary?.settle_type === 'reimburse' ? '#0e7490' : summary?.settle_type === 'return' ? '#a4661c' : '#108548' }}>
                          <span>{summary?.settle_type === 'reimburse' ? 'To reimburse (used more)' : summary?.settle_type === 'return' ? 'To return (used less)' : 'Fully settled (equal)'} · Total used {inr(summary?.settle_actual_amount ?? 0)}</span>
                          <span>{inr(summary?.settle_balance ?? 0)}</span>
                        </div>
                      )}
                    </>
                  ) : allowSettle ? (
                    <div className="esm-settle-start">
                      <div className="esm-settle-start-txt">
                        <div className="esm-settle-start-h">Settle this company advance</div>
                        <div className="esm-settle-start-p">Record where the {inr(settleBase)} was used. You’ll first pick how the spend compares to the advance, then itemise each bill. You can add bills over time and finalise when done.</div>
                      </div>
                      <button type="button" className="esm-sec-btn" onClick={() => { setSettleChosenTmp(''); setSettleMode('choose'); }}>
                        <i className="ri-add-line" /> Add Settle Payment
                      </button>
                    </div>
                  ) : (
                    <div className="esm-hint">Not yet settled by the employee.</div>
                  )}
                </div>
                )}
              </div>
              )}

              {/* ── Settlement approval gate — the finalised usage waits for a
                  branch admin / HR to approve before any return/reimburse. ── */}
              {showSettleSection && settlePendingApproval && (
                <div className="esm-sec">
                  <div className="esm-sec-hd">
                    <div className="esm-sec-l">
                      <span className="esm-sec-ico" style={{ background: '#fef3c7', color: '#a16207' }}><i className="ri-time-line" /></span>
                      <div className="esm-sec-tt">
                        <div className="esm-sec-title-row"><span className="esm-sec-tag">Settlement</span><span className="esm-sec-div">|</span><span className="esm-sec-title">Awaiting approval</span></div>
                        <div className="esm-sec-sub">Total used {inr(summary?.settle_actual_amount ?? 0)}{summary?.settle_type === 'return' ? ` · ${inr(summary?.settle_balance ?? 0)} to return once approved` : summary?.settle_type === 'reimburse' ? ` · ${inr(summary?.settle_balance ?? 0)} to reimburse once approved` : ' · matches the advance'}</div>
                      </div>
                    </div>
                    {canApproveSettle && (
                      <div className="esm-sec-hd-actions" style={{ gap: 8 }}>
                        <button type="button" className="esm-btn-approve" disabled={settleApprovSaving} onClick={approveSettle}><i className="ri-check-line" /> {settleApprovSaving ? 'Saving…' : 'Approve Settlement'}</button>
                        <button type="button" className="esm-btn-ghost" disabled={settleApprovSaving} onClick={rejectSettle}><i className="ri-close-line" /> Reject</button>
                      </div>
                    )}
                  </div>
                  {!canApproveSettle && (
                    <div className="esm-sec-body"><div className="esm-hint"><i className="ri-information-line" /> Your settlement is with a branch admin / HR. Once approved you can {summary?.settle_type === 'return' ? 'return the balance' : summary?.settle_type === 'reimburse' ? 'raise the reimbursement' : 'close it'}.</div></div>
                  )}
                </div>
              )}
              {showSettleSection && settleRejected && (
                <div className="esm-sec">
                  <div className="esm-sec-body">
                    <div className="esm-reimb-done" style={{ background: '#fee2e2', borderColor: '#fecaca', color: '#b91c1c' }}>
                      <i className="ri-close-circle-line" /> <span>Settlement rejected{summary?.settle_approval_comment ? `: ${summary.settle_approval_comment}` : ''}. Review the bills above and submit again.</span>
                    </div>
                  </div>
                </div>
              )}

              {/* ── Settlement payout — return only (make payment). Reimburse is
                  handled in the Settle Advance / finalise flow, not here. ── */}
              {showSettleSection && settleApproved && summary?.settle_type === 'return' && (summary?.settle_balance ?? 0) > 0 && (
              <div className="esm-sec">
                <div className="esm-sec-hd">
                  <div className="esm-sec-l">
                    <span className="esm-sec-ico"><i className="ri-arrow-go-back-line" /></span>
                    <div className="esm-sec-tt">
                      <div className="esm-sec-title-row">
                        <span className="esm-sec-tag">Settlement</span>
                        <span className="esm-sec-div">|</span>
                        <span className="esm-sec-title">Return to Company</span>
                      </div>
                      <div className="esm-sec-sub">Used less than the advance — employee returns the balance to close it</div>
                    </div>
                  </div>
                  <div className="esm-sec-hd-actions">
                    {summary?.settle_return_recovery_mode
                      ? <span className="esm-sec-badge esm-sec-badge--lock" style={{ background: '#eef2ff', color: '#3730a3', borderColor: '#c7d2fe' }}><i className="ri-calendar-todo-line" /> Payroll scheduled</span>
                      : summary?.settle_returned_at
                        ? <span className="esm-sec-badge esm-sec-badge--lock" style={{ background: '#d6f4e3', color: '#108548', borderColor: '#a7e3c2' }}><i className="ri-checkbox-circle-line" /> Returned</span>
                        : <span className="esm-payout-amt" style={{ color: '#a4661c' }}>{inr(returnRemaining)} left</span>}
                    {!summary?.settle_returned_at && (summary?.settle_return_pending ?? 0) > 0 && (
                      <span className="esm-sec-badge" style={{ background: '#fef3c7', color: '#a4661c', borderColor: '#fde68a', marginLeft: 6 }}><i className="ri-time-line" /> {inr(summary?.settle_return_pending ?? 0)} pending approval</span>
                    )}
                  </div>
                </div>
                <div className="esm-sec-body">
                  {(() => {
                    const directPays = (summary?.settle_return_payments ?? []).filter(p => p.mode !== 'payroll');
                    const rm = summary?.settle_return_recovery_mode;
                    const months = summary?.settle_return_recovery_months ?? 1;
                    const perCycle = summary?.settle_return_monthly ?? summary?.settle_balance ?? 0;
                    const methodLbl = rm === 'emi' ? 'EMI' : rm === 'bimonthly' ? 'Bi-monthly' : 'Single lump';
                    const startStr = summary?.settle_return_recovery_start || '';
                    const nextEmi = startStr ? new Date(startStr).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
                    const pill = (txt: string, bg: string, fg: string) => <span style={{ display: 'inline-block', padding: '2px 9px', borderRadius: 999, background: bg, color: fg, fontWeight: 700, fontSize: 10.5 }}>{txt}</span>;
                    // Expand the payroll schedule into one row per instalment.
                    const step = rm === 'bimonthly' ? 2 : 1;
                    const total = summary?.settle_balance ?? 0;
                    const nCycles = rm ? (rm === 'lumpsum' ? 1 : months) : 0;
                    // What payroll has actually recovered on the RETURN stream.
                    const retRecovered = summary?.settle_return_recovered ?? 0;
                    let cumRet = 0;
                    const installments = rm && startStr ? Array.from({ length: nCycles }, (_, k) => {
                      const [y, m] = startStr.split('-').map(Number);
                      const isLast = k === nCycles - 1;
                      const amt = rm === 'lumpsum' ? total : (isLast ? +(total - perCycle * (nCycles - 1)).toFixed(2) : perCycle);
                      const d = new Date(y, (m - 1) + k * step, 1);
                      cumRet += amt;
                      const status = retRecovered + 0.005 >= cumRet ? 'Recovered' : (retRecovered > cumRet - amt + 0.005 ? 'Partial' : 'Pending');
                      return { amt, dateLbl: d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }), n: k + 1, status };
                    }) : [];
                    const hasRows = directPays.length > 0 || !!rm;
                    return (
                      <>
                        {hasRows && (
                          <div className="esm-tblwrap" style={{ marginBottom: 10 }}>
                            <table className="esm-tbl">
                              <thead><tr><th>SR NO</th><th>AMOUNT</th><th>TYPE</th><th>METHOD</th><th>NOTE</th><th>DATE / NEXT</th><th>STATUS</th><th>PROOF</th></tr></thead>
                              <tbody>
                                {directPays.map((p, i) => (
                                  <tr key={i}>
                                    <td>{i + 1}</td>
                                    <td className="esm-tbl-amt">{inr(p.amount)}</td>
                                    <td>{pill('Company Pay', '#cffafe', '#0e7490')}</td>
                                    <td>{p.method || '—'}</td>
                                    <td title={p.note || ''}>{p.note || '—'}</td>
                                    <td>{fmtDate(p.paid_at)}</td>
                                    <td>
                                      {/* Each employee return payment must be confirmed by
                                          branch admin / HR before it closes the return. */}
                                      <span title={p.status === 'rejected' ? (p.rejected_reason || 'Rejected') : ''}>
                                        {p.status === 'rejected'
                                          ? pill('Rejected', '#fee2e2', '#b91c1c')
                                          : p.status === 'pending'
                                            ? pill('Pending approval', '#fef3c7', '#a4661c')
                                            : pill('Approved', '#d6f4e3', '#108548')}
                                      </span>
                                      {canApproveSettle && p.status === 'pending' && (
                                        <span style={{ display: 'inline-flex', gap: 4, marginLeft: 6, verticalAlign: 'middle' }}>
                                          <button type="button" title="Approve — money received" disabled={returnPayBusy !== null} onClick={() => approveReturnPayment(p.index ?? i)} style={{ border: 'none', borderRadius: 6, padding: '2px 7px', background: '#108548', color: '#fff', fontSize: 10, fontWeight: 800, cursor: returnPayBusy !== null ? 'wait' : 'pointer' }}><i className="ri-check-line" /></button>
                                          <button type="button" title="Reject — not received" disabled={returnPayBusy !== null} onClick={() => rejectReturnPayment(p.index ?? i)} style={{ border: 'none', borderRadius: 6, padding: '2px 7px', background: '#dc2626', color: '#fff', fontSize: 10, fontWeight: 800, cursor: returnPayBusy !== null ? 'wait' : 'pointer' }}><i className="ri-close-line" /></button>
                                        </span>
                                      )}
                                    </td>
                                    <td>{p.proof_url ? <a className="esm-tbl-link" href={tokenUrl(p.proof_url)} target="_blank" rel="noreferrer"><i className="ri-attachment-2" /> View</a> : '—'}</td>
                                  </tr>
                                ))}
                                {installments.map((it, k) => (
                                  <tr key={`pr-${k}`}>
                                    <td>{directPays.length + k + 1}</td>
                                    <td className="esm-tbl-amt">{inr(it.amt)}</td>
                                    <td>{pill('Payroll', '#eef2ff', '#3730a3')}</td>
                                    <td>{methodLbl}</td>
                                    <td>{rm === 'lumpsum' ? 'One-time' : `Instalment ${it.n} of ${nCycles}`}</td>
                                    <td>{it.dateLbl}</td>
                                    <td>{it.status === 'Recovered' ? pill('Recovered', '#dcfce7', '#15803d') : it.status === 'Partial' ? pill('Partial', '#e0e7ff', '#3730a3') : pill('Pending', '#fef3c7', '#a4661c')}</td>
                                    <td>—</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                        {rm ? (
                          <div className="esm-reimb-done" style={{ background: '#eef2ff', borderColor: '#c7d2fe', color: '#3730a3' }}><i className="ri-calendar-todo-line" /> <span>Recovery of {inr(summary?.settle_balance ?? 0)} scheduled from payroll — {methodLbl}, next deduction {nextEmi}.</span></div>
                        ) : summary?.settle_returned_at ? (
                          <div className="esm-reimb-done"><i className="ri-checkbox-circle-fill" /> <span>Balance of {inr(summary?.settle_balance ?? 0)} returned to the company in full.</span></div>
                        ) : (returnRemaining <= 0.005 && (summary?.settle_return_pending ?? 0) > 0) ? (
                          // Whole balance recorded, but a payment is still awaiting
                          // HR/branch confirmation — the return isn't closed yet.
                          <div className="esm-reimb-done" style={{ background: '#fffbeb', borderColor: '#fde68a', color: '#a4661c' }}><i className="ri-time-line" /> <span>{inr(summary?.settle_return_pending ?? 0)} recorded — awaiting branch admin / HR approval to close the return.</span></div>
                        ) : canApproveSettle ? (
                          // HR / branch view — recording the return is the EMPLOYEE's
                          // action; HR only confirms each payment they record. No
                          // Make Payment button here.
                          <div className="esm-payout-row">
                            <span className="esm-payout-note"><strong>{inr(returnRemaining)}</strong> to be returned by the employee. You'll confirm each payment they record.</span>
                          </div>
                        ) : (
                          <div className="esm-payout-row">
                            <span className="esm-payout-note">You return <strong>{inr(returnRemaining)}</strong> to the company. Pay directly (instalments allowed) or cut it from payroll — each payment is confirmed by branch admin / HR.</span>
                            <button type="button" className="esm-btn-primary esm-payout-btn" onClick={() => { setReturnStep('mode'); setReturnMode(''); setReturnAmount(String(returnRemaining)); setReturnMethod(''); setReturnProof(null); setReturnErr(false); setReturnOpen(true); }}><i className="ri-bank-card-line" /> Make Payment</button>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>
              )}

              {/* ── Raised Expense (reimburse follow-through) ── */}
              {showSettleSection && settleApproved && summary?.settle_type === 'reimburse' && (summary?.settle_balance ?? 0) > 0 && (
              <div className="esm-sec">
                <div className="esm-sec-hd">
                  <div className="esm-sec-l">
                    <span className="esm-sec-ico"><i className="ri-refund-2-line" /></span>
                    <div className="esm-sec-tt">
                      <div className="esm-sec-title-row">
                        <span className="esm-sec-tag">Settlement</span>
                        <span className="esm-sec-div">|</span>
                        <span className="esm-sec-title">Raised Expense</span>
                      </div>
                      <div className="esm-sec-sub">Used more than the advance — reimbursement claim for the extra</div>
                    </div>
                  </div>
                  <div className="esm-sec-hd-actions">
                    {summary?.settle_reimbursement
                      ? <span className="esm-sec-badge esm-sec-badge--lock" style={{ background: '#d6f4e3', color: '#108548', borderColor: '#a7e3c2' }}><i className="ri-checkbox-circle-line" /> Raised</span>
                      : <span className="esm-payout-amt" style={{ color: '#0e7490' }}>{inr(summary?.settle_balance ?? 0)}</span>}
                  </div>
                </div>
                <div className="esm-sec-body">
                  {summary?.settle_reimbursement ? (
                    <div className="esm-tblwrap">
                      <table className="esm-tbl">
                        <thead><tr><th>EXPENSE ID</th><th>AMOUNT</th><th>CATEGORY</th><th>CURRENCY</th><th>STATUS</th><th>PROOF</th></tr></thead>
                        <tbody><tr>
                          <td className="esm-tbl-amt" style={{ fontWeight: 700 }}>{summary.settle_reimbursement.claim_no}</td>
                          <td className="esm-tbl-amt">{inr(summary.settle_reimbursement.amount ?? summary.settle_balance ?? 0)}</td>
                          <td>{summary.settle_reimbursement.category || '—'}</td>
                          <td>{summary.settle_reimbursement.currency || 'INR'}</td>
                          <td><span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 999, background: '#e0f2fe', color: '#0369a1', fontWeight: 700, fontSize: 11, textTransform: 'capitalize' }}>{summary.settle_reimbursement.status}</span></td>
                          <td>{summary.settle_reimbursement.proof_url ? <a className="esm-tbl-link" href={tokenUrl(summary.settle_reimbursement.proof_url)} target="_blank" rel="noreferrer" title={summary.settle_reimbursement.proof_name || 'Proof'}><i className="ri-attachment-2" /> {summary.settle_reimbursement.proof_name || 'View'}</a> : '—'}</td>
                        </tr></tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="esm-payout-row">
                      <span className="esm-payout-note">Raise a reimbursement expense of <strong>{inr(summary?.settle_balance ?? 0)}</strong> for the amount spent over the advance.</span>
                      <button type="button" className="esm-btn-primary esm-payout-btn" onClick={raiseOrOpenReimbursement} disabled={raising}><i className="ri-file-add-line" /> {raising ? 'Raising…' : 'Raise Expense'}</button>
                    </div>
                  )}
                </div>
              </div>
              )}
            </>
          )}
        </div>

        {/* ── Footer ── */}
        {managerStageRedirect ? (
          // Manager-stage row on the HR Expense page — not actionable here.
          <div className="esm-foot">
            <div className="esm-foot-hint"><i className="ri-information-line" /> Reporting-manager approval is done from the Inbox.</div>
            <div className="esm-foot-r">
              <button className="esm-btn-approve" style={{ background: 'linear-gradient(135deg,#4F46E5,#7C3AED)' }} onClick={() => { onGoToInbox?.(); onClose(); }}><i className="ri-inbox-archive-line" style={{ marginRight: 6 }} /> Go to Inbox</button>
              <button className="esm-btn-ghost" onClick={onClose}>Close</button>
            </div>
          </div>
        ) : inReview ? (
          <div className="esm-foot">
            <div className="esm-foot-hint"><i className="ri-information-line" /> {managerReview ? `Review the ${noun}, then approve or reject.` : `Set adjustments (if any), then approve — net payable ${inr(sanctioned)}.`}</div>
            <div className="esm-foot-r">
              {/* When net payable ≤ 0 the button stays clickable but reads as
                  disabled, so clicking it fires requestApprove()'s toast
                  ("Net payable must be greater than zero") instead of doing
                  nothing — a truly `disabled` button swallows the click. */}
              <button
                className="esm-btn-approve"
                onClick={requestApprove}
                disabled={saving}
                aria-disabled={!managerReview && sanctioned <= 0}
                style={(!managerReview && sanctioned <= 0) ? { opacity: .55, cursor: 'not-allowed' } : undefined}
              >Approve</button>
              <button className="esm-btn-reject" onClick={() => { setRejectReason(''); setConfirmKind('reject'); }} disabled={saving}>Reject</button>
              <button className="esm-btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
            </div>
          </div>
        ) : (
        <div className="esm-foot">
          <div className="esm-foot-hint">
            <i className="ri-information-line" />
            {readOnly
              ? (fullyPaid ? 'This claim is fully paid.' : firstPayment ? 'This claim has not been settled yet.' : `${inr(paidSoFar)} paid · ${inr(remaining)} remaining.`)
              : (fullyPaid ? 'This claim is fully paid.' : firstPayment ? 'Submit the one-time deduction, then use “+ Add Payment”.' : `Remaining ${inr(remaining)} — use “+ Add Payment” to disburse.`)}
          </div>
          <div className="esm-foot-r">
            <button className="esm-btn-ghost" onClick={onClose} disabled={saving}>{readOnly ? 'Close' : 'Cancel'}</button>
          </div>
        </div>
        )}
      </div>

      {/* ── Add Payment — nested popup over the overview ── */}
      {showForm && summary && (
        <div className="esm-sub-backdrop" onMouseDown={() => { if (!saving) setShowForm(false); }}>
          <div className="esm-sub-modal" onMouseDown={e => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="esm-sub-head">
              <div className="esm-sub-head-l">
                <span className="esm-sub-head-ico"><i className="ri-bank-card-line" /></span>
                <div>
                  <div className="esm-sub-title">Record Payment</div>
                  <div className="esm-sub-hsub">
                    <span className="esm-sub-chip">{summary.claim_no || `#${summary.id}`}</span>
                    <span className="esm-sub-dot">•</span>
                    <span>{summary.employee_name || '—'}</span>
                  </div>
                </div>
              </div>
              <button type="button" className="esm-sub-x" onClick={() => setShowForm(false)} disabled={saving} aria-label="Close">✕</button>
            </div>
            <div className="esm-sub-body">
              {/* Outstanding balance strip (mirrors the PO "Update Payment" popup) */}
              <div className="esm-bal">
                <span className="esm-bal-ico"><IcoWallet /></span>
                <div className="esm-bal-txt">
                  <div className="esm-bal-lab">REMAINING (NET PAYABLE)</div>
                  <div className="esm-bal-val">{inr(remaining)}</div>
                </div>
                <div className="esm-bal-chips">
                  <span className="esm-bal-chip">Claimed {inr(claimed)}</span>
                  <span className="esm-bal-chip is-net">Net Payable {inr(sanctioned)}</span>
                  <span className="esm-bal-chip">Paid {inr(paidSoFar)}</span>
                </div>
              </div>
              <div className="esm-fgrid">
                {/* Row 1 — Category · Payment Method · Expense Type (4·4·4).
                    Advances have no Category / Expense Type — the payout only
                    carries a Payment Method, so it spans the full row. */}
                {!isAdvance && (
                <div className="esm-fld s4">
                  <label>CATEGORY <span className="esm-req">*</span></label>
                  <MasterSelect
                    value={categoryId}
                    onChange={setCategoryId}
                    invalid={showErrors && !categoryId}
                    options={cats.map(c => ({ value: String(c.id), label: c.name }))}
                    placeholder="Select category"
                  />
                  {showErrors && !categoryId && <span className="esm-err">Select a category.</span>}
                </div>
                )}
                <div className={`esm-fld ${isAdvance ? 's12' : 's4'}`}>
                  <label>PAYMENT METHOD <span className="esm-req">*</span></label>
                  <MasterSelect
                    value={paymentType}
                    onChange={setPaymentType}
                    invalid={showErrors && !paymentType}
                    options={['UPI', 'PhonePe', 'Cheque', 'Bank Transfer'].map(v => ({ value: v, label: v }))}
                    placeholder="Select method"
                  />
                  {showErrors && !paymentType && <span className="esm-err">Select a payment method.</span>}
                </div>
                {!isAdvance && (
                <div className="esm-fld s4">
                  <label>EXPENSE TYPE <span className="esm-req">*</span></label>
                  <div className="esm-radio-row">
                    {['Goods', 'Service'].map(v => (
                      <label key={v} className={`esm-radio ${expenseType === v ? 'is-on' : ''}`}>
                        <input type="radio" name="esm-exptype" checked={expenseType === v} onChange={() => setExpenseType(v)} />
                        {v}
                      </label>
                    ))}
                  </div>
                  {showErrors && !expenseType && <span className="esm-err">Select an expense type.</span>}
                </div>
                )}

                {/* Row 2 — Amount To Pay (4) · Proof of Payment (8) */}
                <div className={`esm-fld s4 ${showErrors && (amountNum <= 0 || amountNum > remaining + 0.005) ? 'esm-fld--err' : ''}`}>
                  <label>AMOUNT TO PAY <span className="esm-req">*</span> <span className="esm-muted">(max {inr(remaining)})</span></label>
                  <div className="esm-money"><span className="esm-cur">₹</span>
                    <input className="esm-in" type="number" min={0} value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" />
                  </div>
                  {showErrors && amountNum <= 0 && <span className="esm-err">Enter an amount.</span>}
                  {showErrors && amountNum > remaining + 0.005 && <span className="esm-err">Cannot exceed {inr(remaining)}.</span>}
                </div>
                <div className={`esm-fld s8 ${showErrors && !proofFile ? 'esm-fld--err' : ''}`}>
                  <label>PROOF OF PAYMENT <span className="esm-req">*</span></label>
                  {!proofFile ? (
                    <label className="esm-file">
                      <i className="ri-attachment-2" />
                      <span>Attach receipt / transfer proof</span>
                      <input type="file" accept={PROOF_ACCEPT} onChange={e => setProofFile(acceptProof(e.target.files?.[0]))} />
                    </label>
                  ) : (
                    <div className="esm-file-chip">
                      <i className="ri-file-text-line esm-file-ic" />
                      <span className="esm-file-name" title={proofFile.name}>{proofFile.name}</span>
                      <button type="button" className="esm-file-btn" onClick={() => viewFile(proofFile)}><i className="ri-eye-line" /> View</button>
                      <button type="button" className="esm-file-btn" onClick={() => downloadProof(proofFile)} disabled={proofDownloading}>
                        <i className={proofDownloading ? 'ri-loader-4-line ri-spin' : 'ri-download-2-line'} /> Download
                      </button>
                      <label className="esm-file-btn" title="Replace file"><i className="ri-refresh-line" /><span>Reupload</span>
                        <input type="file" accept={PROOF_ACCEPT} onChange={e => setProofFile(acceptProof(e.target.files?.[0]) ?? proofFile)} />
                      </label>
                    </div>
                  )}
                  {showErrors && !proofFile && <span className="esm-err">Attach proof of payment.</span>}
                </div>

                {/* Row 3 — Note (12) */}
                <div className={`esm-fld s12 ${showErrors && !note.trim() ? 'esm-fld--err' : ''}`}>
                  <label>NOTE <span className="esm-req">*</span></label>
                  <textarea className="esm-in" rows={2} maxLength={500} value={note} onChange={e => setNote(e.target.value)} />
                  <div className="esm-note-foot">
                    {showErrors && !note.trim() ? <span className="esm-err">A note is required.</span> : <span />}
                    <span className="esm-note-count">{note.length}/500</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="esm-sub-foot">
              <div className="esm-foot-hint"><i className="ri-information-line" /> Up to {inr(remaining)} can be paid.</div>
              <div className="esm-foot-r">
                <button className="esm-btn-primary" onClick={submit} disabled={saving}>{saving ? 'Recording…' : 'Record Payment'}</button>
                <button className="esm-btn-ghost" onClick={() => setShowForm(false)} disabled={saving}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Settle Advance — pick outcome type (locked once chosen) ── */}
      {settleMode === 'choose' && summary && (
        <div className="esm-sub-backdrop" onMouseDown={() => setSettleMode('idle')}>
          <div className="esm-confirm esm-confirm--wide" onMouseDown={e => e.stopPropagation()} role="dialog" aria-modal="true">
            <span className="esm-confirm-ico is-approve"><i className="ri-check-double-line" /></span>
            <div className="esm-confirm-title">Settle Advance</div>
            <div className="esm-confirm-sub">Advance amount <strong>{inr(settleBase)}</strong>. Pick how your spend compares to the advance.</div>
            <div className="esm-choose-fld">
              <label>EXPENSE USED <span className="esm-req">*</span></label>
              <MasterSelect
                value={settleChosenTmp}
                onChange={(v) => { setSettleChosenTmp(v as any); if (v === 'equal') setSettleTargetTmp(String(settleBase)); else setSettleTargetTmp(''); }}
                options={[
                  { value: 'equal', label: 'Equal — used exactly the advance' },
                  { value: 'minimum', label: 'Minimum — used less (return balance)' },
                  { value: 'maximum', label: 'Maximum — used more (reimburse balance)' },
                ]}
                placeholder="Select how the advance was used"
              />
            </div>
            {settleChosenTmp && (
              <div className="esm-choose-fld">
                <label>AMOUNT USED <span className="esm-req">*</span> {settleChosenTmp === 'minimum' ? <span className="esm-muted">(less than {inr(settleBase)})</span> : settleChosenTmp === 'maximum' ? <span className="esm-muted">(more than {inr(settleBase)})</span> : <span className="esm-muted">(auto — equals the advance)</span>}</label>
                <div className="esm-money"><span className="esm-cur">₹</span>
                  <input className="esm-in" type="number" min={0} placeholder="0.00"
                    value={settleChosenTmp === 'equal' ? String(settleBase) : settleTargetTmp}
                    readOnly={settleChosenTmp === 'equal'}
                    onChange={e => setSettleTargetTmp(e.target.value)} />
                </div>
                {settleChosenTmp === 'minimum' && !!settleTargetTmp && !(Number(settleTargetTmp) > 0 && Number(settleTargetTmp) < settleBase) && <span className="esm-err">Must be greater than 0 and less than {inr(settleBase)}.</span>}
                {settleChosenTmp === 'maximum' && !!settleTargetTmp && !(Number(settleTargetTmp) > settleBase) && <span className="esm-err">Must be greater than {inr(settleBase)}.</span>}
              </div>
            )}
            <div className="esm-choose-note">
              <i className="ri-error-warning-line" />
              <span>Once you continue, the settlement type and amount are <strong>locked and can’t be changed</strong>. Your bills must total this amount to finalise.</span>
            </div>
            {(() => {
              const t = Number(settleTargetTmp) || 0;
              const valid = settleChosenTmp === 'equal'
                || (settleChosenTmp === 'minimum' && t > 0 && t < settleBase)
                || (settleChosenTmp === 'maximum' && t > settleBase);
              return (
                <div className="esm-confirm-actions">
                  <button type="button" className="esm-btn-approve" disabled={!valid} onClick={() => { setSettleChosen(settleChosenTmp); setSettleTarget(settleChosenTmp === 'equal' ? String(settleBase) : settleTargetTmp); setSettleMode('form'); }}>Continue</button>
                  <button type="button" className="esm-btn-ghost" onClick={() => setSettleMode('idle')}>Cancel</button>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* ── Settle Advance — itemised usage form (nested popup) ── */}
      {settleMode === 'form' && summary && (
        <div className="esm-sub-backdrop" onMouseDown={() => { if (!settleSaving) setSettleMode('idle'); }}>
          <div className="esm-sub-modal esm-sub-modal--settle" onMouseDown={e => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="esm-sub-head">
              <div className="esm-sub-head-l">
                <span className="esm-sub-head-ico"><i className="ri-check-double-line" /></span>
                <div>
                  <div className="esm-sub-title">Settle Advance</div>
                  <div className="esm-sub-hsub">
                    <span className="esm-sub-chip">{summary.claim_no || `#${summary.id}`}</span>
                    <span className="esm-sub-dot">•</span>
                    <span>{summary.employee_name || '—'}</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="esm-sub-body">
              {/* Advance amount + locked type + declared "amount to account" */}
              <div className="esm-settle-strip">
                <div className="esm-settle-stat">
                  <span className="esm-settle-stat-ic"><IcoWallet /></span>
                  <div>
                    <div className="esm-settle-stat-lab">ADVANCE AMOUNT</div>
                    <div className="esm-settle-stat-val" title={inr(settleBase)}>{inr(settleBase)}</div>
                  </div>
                </div>
                {effectiveType && (
                  <div className="esm-settle-stat">
                    <span className="esm-settle-stat-ic is-type"><i className="ri-lock-2-line" /></span>
                    <div>
                      <div className="esm-settle-stat-lab">SETTLEMENT TYPE</div>
                      <div className="esm-settle-stat-val esm-settle-stat-val--sm">{effectiveType === 'equal' ? 'Equal — used exactly' : effectiveType === 'minimum' ? 'Minimum — used less' : 'Maximum — used more'}</div>
                    </div>
                  </div>
                )}
                {settleGoal > 0 && (
                  <div className="esm-settle-stat">
                    <span className="esm-settle-stat-ic is-goal"><i className="ri-focus-3-line" /></span>
                    <div>
                      <div className="esm-settle-stat-lab">USED AMOUNT</div>
                      <div className="esm-settle-stat-val" title={inr(settleGoal)}>{inr(settleGoal)}</div>
                    </div>
                  </div>
                )}
              </div>
              <div className="esm-settle-rows">
                <div className="esm-srow esm-srow-hd">
                  <span>AMOUNT <span className="esm-req">*</span></span>
                  <span>REASON / WHERE USED <span className="esm-req">*</span></span>
                  <span>PAYMENT METHOD <span className="esm-req">*</span></span>
                  <span>PROOF <span className="esm-req">*</span></span>
                  <span />
                </div>
                <div className="esm-srow-scroll">
                {/* Previously-saved bills — locked, can't be removed or edited. */}
                {existingSettleItems.map((it, i) => (
                  <div className="esm-srow esm-srow--locked" key={`ex-${i}`}>
                    <div className="esm-ded-amt"><span className="esm-cur">₹</span>
                      <input className="esm-in" value={inr(it.amount).replace('₹', '')} readOnly tabIndex={-1} />
                    </div>
                    <input className="esm-in" value={it.reason || ''} readOnly tabIndex={-1} />
                    <input className="esm-in" value={it.method || '—'} readOnly tabIndex={-1} />
                    {it.proof_url ? (
                      <a className="esm-file-chip esm-srow-file" href={tokenUrl(it.proof_url)} target="_blank" rel="noreferrer" title={it.proof_name || 'Proof'} style={{ textDecoration: 'none' }}>
                        <i className="ri-file-text-line esm-file-ic" />
                        <span className="esm-file-name">{it.proof_name || 'View'}</span>
                      </a>
                    ) : <span className="esm-srow-file" />}
                    <span className="esm-srow-lockic" title="Saved — locked"><i className="ri-lock-2-line" /></span>
                  </div>
                ))}
                {!settleSavedMet && settleRows.map((r, i) => (
                  <div className="esm-srow" key={i}>
                    <div className="esm-ded-amt"><span className="esm-cur">₹</span>
                      <input className="esm-in" type="number" min={0} placeholder="0.00" value={r.amount} onChange={e => { setSettleRow(i, { amount: e.target.value }); }} />
                    </div>
                    <input className="esm-in" placeholder="e.g. Hotel bill, cab fare…" maxLength={500} value={r.reason} onChange={e => setSettleRow(i, { reason: e.target.value })} />
                    <div className="esm-srow-method">
                      <MasterSelect
                        value={r.method}
                        onChange={(v) => setSettleRow(i, { method: v })}
                        options={['UPI', 'PhonePe', 'Cheque', 'Bank Transfer'].map(v => ({ value: v, label: v }))}
                        placeholder="Method"
                      />
                    </div>
                    {!r.proof ? (
                      <label className="esm-file esm-srow-file">
                        <i className="ri-attachment-2" /> <span>Proof</span>
                        <input type="file" accept={PROOF_ACCEPT} onChange={e => setSettleRow(i, { proof: acceptProof(e.target.files?.[0]) })} />
                      </label>
                    ) : (
                      <div className="esm-file-chip esm-srow-file" title={r.proof.name}>
                        <i className="ri-file-text-line esm-file-ic" />
                        <span className="esm-file-name">{r.proof.name}</span>
                        <label className="esm-file-btn" title="Replace"><i className="ri-refresh-line" /><input type="file" hidden accept={PROOF_ACCEPT} onChange={e => setSettleRow(i, { proof: acceptProof(e.target.files?.[0]) })} /></label>
                      </div>
                    )}
                    <button type="button" className="esm-srow-x" onClick={() => removeSettleRow(i)} disabled={settleRows.length === 1} aria-label="Remove row"><i className="ri-delete-bin-6-line" /></button>
                  </div>
                ))}
                </div>
                {!settleSavedMet && (
                  <button type="button" className="esm-ded-add esm-srow-add" onClick={addSettleRow}>+ Add row</button>
                )}
                {!settleSavedMet && settleErr && settleRows.some(r => (Number(r.amount) > 0 || r.reason.trim() || r.method || r.proof) && !(Number(r.amount) > 0 && r.reason.trim() && r.method && r.proof)) && (
                  <div className="esm-err" style={{ marginTop: 6 }}>Each row needs an amount, a reason, a payment method and a proof.</div>
                )}
                {settleSavedMet && (
                  <div className="esm-settle-donenote">
                    <i className="ri-checkbox-circle-fill" />
                    <span>You’ve accounted for the full used amount ({inr(settleGoal)}).{' '}
                      {effectiveType === 'maximum' ? 'You can now raise your reimbursement expense.' : effectiveType === 'minimum' ? 'Record the return payment to close the advance.' : 'Finalise to lock the settlement.'}</span>
                  </div>
                )}
              </div>
              {/* Totals + outcome action, side by side */}
              <div className="esm-settle-grid">
                <div className="esm-settle-sum">
                  <div className="esm-sumrow"><span>Advance amount</span><span>{inr(settleBase)}</span></div>
                  <div className="esm-sumrow"><span>Used amount (declared)</span><span>{inr(settleGoal)}</span></div>
                  {(() => { const nBills = existingSettleItems.length + settleRows.filter(r => Number(r.amount) > 0).length; return (
                  <div className="esm-sumrow"><span>Total used ({nBills} {nBills === 1 ? 'bill' : 'bills'})</span><span>{inr(settleTotal)}</span></div>
                  ); })()}
                  <div className="esm-sumrow is-grand" style={{ background: overTarget ? 'linear-gradient(120deg,#e11d48,#f43f5e)' : targetMet ? 'linear-gradient(120deg,#059669,#10b981)' : 'linear-gradient(120deg,#64748b,#94a3b8)' }}>
                    <span>{overTarget ? 'Over the used amount' : targetMet ? 'Accounted in full' : 'Remaining to account'}</span>
                    <span>{overTarget ? '+' + inr(settleTotal - settleGoal) : targetMet ? inr(settleGoal) : inr(settlePending)}</span>
                  </div>
                </div>
                {(() => {
                  const bal = Math.abs(settleGoal - settleBase);
                  // The action only depends on SAVED bills — unsaved rows must be
                  // saved first. Live-typed rows never enable the button.
                  const hasUnsaved = settleRows.some(rowTouched);
                  const savedMet = settleGoal > 0 && Math.abs(existingSettleTotal - settleGoal) <= 0.005;
                  const canAct = savedMet && !hasUnsaved;
                  const lab = effectiveType === 'minimum' ? 'EMPLOYEE TO RETURN' : effectiveType === 'maximum' ? 'REIMBURSE EMPLOYEE' : 'NOTHING TO SETTLE';
                  const amt = effectiveType === 'equal' ? '₹0.00' : inr(bal);
                  const amtCls = effectiveType === 'minimum' ? 'is-return' : effectiveType === 'maximum' ? 'is-reimburse' : 'is-equal';
                  const actLabel = effectiveType === 'minimum' ? 'Make Payment' : effectiveType === 'maximum' ? 'Raise Expense' : 'Finalize settlement';
                  const actIcon  = effectiveType === 'minimum' ? 'ri-bank-card-line' : effectiveType === 'maximum' ? 'ri-file-add-line' : 'ri-lock-2-line';
                  const helper = hasUnsaved
                    ? 'Save the bills first — then you can ' + actLabel.toLowerCase() + '.'
                    : !savedMet
                      ? `${actLabel} unlocks once the saved bills total ${inr(settleGoal)}.`
                      : effectiveType === 'minimum'
                        ? 'Used less than the advance. Record the returned amount to close it.'
                        : effectiveType === 'maximum'
                          ? 'Spent more than the advance. Raise a reimbursement to close it.'
                          : 'Usage matches the advance exactly. Finalise to lock it.';
                  return (
                    <div className={`esm-settle-action ${canAct ? 'is-ready' : ''}`}>
                      <div className="esm-act-lab">{canAct ? lab : 'REMAINING TO ACCOUNT'}</div>
                      <div className={`esm-act-amt ${canAct ? amtCls : 'is-pending'}`}>{canAct ? amt : inr(settlePending)}</div>
                      <div className="esm-act-p">{helper}</div>
                      <button type="button" className="esm-btn-primary esm-act-btn" onClick={() => setSettleFinalizeAsk(true)} disabled={!canAct || settleSaving} title={!canAct ? (hasUnsaved ? 'Save the bills first' : `Saved bills must total ${inr(settleGoal)}`) : ''}><i className={actIcon} /> {actLabel}</button>
                    </div>
                  );
                })()}
              </div>
            </div>
            <div className="esm-sub-foot">
              <div className="esm-foot-hint"><i className="ri-information-line" /> Add bills any time — saved bills lock.</div>
              <div className="esm-foot-r">
                <button type="button" className="esm-btn-ghost" onClick={() => setSettleMode('idle')} disabled={settleSaving}>Cancel</button>
                <button type="button" className="esm-btn-soft" onClick={() => submitSettle(false)} disabled={settleSaving}>{settleSaving ? 'Saving…' : 'Save bills'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Finalize settlement confirmation ── */}
      {settleFinalizeAsk && summary && (
        <div className="esm-sub-backdrop" onMouseDown={() => { if (!settleSaving) setSettleFinalizeAsk(false); }}>
          <div className="esm-confirm" onMouseDown={e => e.stopPropagation()} role="dialog" aria-modal="true">
            <span className="esm-confirm-ico is-approve"><i className="ri-lock-2-line" /></span>
            <div className="esm-confirm-title">Finalise this settlement?</div>
            <div className="esm-confirm-msg">
              Total used <b>{inr(settleTotal)}</b> of <b>{inr(settleBase)}</b>.{' '}
              {settleType === 'minimum' ? <>Employee must <b>return {inr(settleBalance)}</b>.</> : settleType === 'maximum' ? <>Company must <b>reimburse {inr(settleBalance)}</b>.</> : <>Usage <b>matches</b> the advance.</>}
              {' '}Once finalised, <b>no more bills can be added</b> and the advance is locked.
            </div>
            <div className="esm-confirm-actions">
              <button type="button" className="esm-btn-approve" onClick={() => submitSettle(true)} disabled={settleSaving}>{settleSaving ? 'Finalising…' : 'Finalise & lock'}</button>
              <button type="button" className="esm-btn-ghost" onClick={() => setSettleFinalizeAsk(false)} disabled={settleSaving}>Back</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Make Payment (return) — wide modal: mode → form (like Record Payment) ── */}
      {returnOpen && summary && (
        <div className="esm-sub-backdrop" onMouseDown={() => { if (!returnSaving) setReturnOpen(false); }}>
          <div className="esm-sub-modal esm-sub-modal--settle" onMouseDown={e => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="esm-sub-head">
              <div className="esm-sub-head-l">
                <span className="esm-sub-head-ico"><i className="ri-arrow-go-back-line" /></span>
                <div>
                  <div className="esm-sub-title">Return to Company</div>
                  <div className="esm-sub-hsub">
                    <span className="esm-sub-chip">{summary.claim_no || `#${summary.id}`}</span>
                    <span className="esm-sub-dot">•</span>
                    <span>{summary.employee_name || '—'}</span>
                  </div>
                </div>
              </div>
              <button type="button" className="esm-sub-x" onClick={() => setReturnOpen(false)} disabled={returnSaving} aria-label="Close">✕</button>
            </div>
            <div className="esm-sub-body">
              {/* Pending-return strip (mirrors the Record Payment balance strip) */}
              <div className="esm-bal">
                <span className="esm-bal-ico"><IcoWallet /></span>
                <div className="esm-bal-txt">
                  <div className="esm-bal-lab">PENDING RETURN (TO COMPANY)</div>
                  <div className="esm-bal-val">{inr(returnRemaining)}</div>
                </div>
                <div className="esm-bal-chips">
                  <span className="esm-bal-chip">Balance {inr(summary?.settle_balance ?? 0)}</span>
                  {(summary?.settle_return_payments?.length ?? 0) > 0 && <span className="esm-bal-chip">Returned {inr((summary?.settle_balance ?? 0) - returnRemaining)}</span>}
                  {empSalary != null && <span className="esm-bal-chip is-net">Monthly salary {inr(empSalary)}</span>}
                </div>
              </div>

              {/* Stepper — boxed wizard style (icon badge + number badge) */}
              <div className="esm-wstepper">
                {[
                  { n: 1, title: 'Return method', sub: 'How to return the balance', icon: 'ri-arrow-go-back-line' },
                  { n: 2, title: 'Payment details', sub: returnMode === 'payroll' ? 'Recovery schedule' : returnMode === 'direct' ? 'Amount & proof' : 'Enter the details', icon: 'ri-bank-card-line' },
                ].map((s, i, arr) => {
                  const isActive = (returnStep === 'mode' && s.n === 1) || (returnStep === 'form' && s.n === 2);
                  const isDone = returnStep === 'form' && s.n === 1;
                  const cls = isActive ? 'esm-wstep-active' : isDone ? 'esm-wstep-done' : 'esm-wstep-pending';
                  return (
                    <Fragment key={s.n}>
                      <div className={`esm-wstep ${cls}`} onClick={() => { if (s.n === 1) setReturnStep('mode'); else if (returnMode) setReturnStep('form'); }}>
                        <div className="esm-wstep-badge-wrap">
                          <div className="esm-wstep-badge">{isDone ? <i className="ri-check-line" /> : <i className={s.icon} />}</div>
                          <div className="esm-wstep-num">{isDone ? <i className="ri-check-line" /> : s.n}</div>
                        </div>
                        <div className="esm-wstep-text">
                          <div className="esm-wstep-title">{s.title}</div>
                          <div className="esm-wstep-sub">{s.sub}</div>
                        </div>
                      </div>
                      {i < arr.length - 1 && (
                        <div className="esm-wstep-connector"><div className="esm-wconnector-line" data-done={isDone ? '1' : '0'} /></div>
                      )}
                    </Fragment>
                  );
                })}
              </div>

              {returnStep === 'mode' ? (
                <div className="esm-return-modes">
                  <button type="button" className={`esm-return-mode ${returnMode === 'direct' ? 'is-on' : ''}`} onClick={() => setReturnMode('direct')}>
                    <i className="ri-bank-card-line" />
                    <div><div className="esm-return-mode-t">Pay to Company now</div><div className="esm-return-mode-s">Record a payment (instalments allowed)</div></div>
                  </button>
                  <button type="button" className={`esm-return-mode ${returnMode === 'payroll' ? 'is-on' : ''}`} onClick={() => setReturnMode('payroll')}>
                    <i className="ri-wallet-3-line" />
                    <div><div className="esm-return-mode-t">Cut from Payroll</div><div className="esm-return-mode-s">Deduct {inr(returnRemaining)} from salary</div></div>
                  </button>
                </div>
              ) : returnMode === 'direct' ? (
                <div className="esm-fgrid">
                  <div className={`esm-fld s4 ${returnErr && !(Number(returnAmount) > 0) ? 'esm-fld--err' : ''}`}>
                    <label>AMOUNT <span className="esm-req">*</span> <span className="esm-muted">(max {inr(returnRemaining)})</span></label>
                    <div className="esm-money"><span className="esm-cur">₹</span>
                      <input className="esm-in" type="number" min={0} placeholder="0.00" value={returnAmount} onChange={e => { let v = e.target.value; if ((Number(v) || 0) > returnRemaining) v = String(returnRemaining); setReturnAmount(v); }} />
                    </div>
                    {returnErr && !(Number(returnAmount) > 0) && <span className="esm-err">Enter an amount.</span>}
                  </div>
                  <div className={`esm-fld s4 ${returnErr && !returnMethod ? 'esm-fld--err' : ''}`}>
                    <label>PAYMENT METHOD <span className="esm-req">*</span></label>
                    <MasterSelect value={returnMethod} onChange={(v) => setReturnMethod(v)} options={['UPI', 'PhonePe', 'Cheque', 'Bank Transfer', 'Cash'].map(v => ({ value: v, label: v }))} placeholder="How was it returned?" />
                    {returnErr && !returnMethod && <span className="esm-err">Select a payment method.</span>}
                  </div>
                  <div className="esm-fld s4">
                    <label>PROOF <span className="esm-muted">(optional)</span></label>
                    {!returnProof ? (
                      <label className="esm-file" style={{ height: 41 }}>
                        <i className="ri-attachment-2" /> <span>Attach proof</span>
                        <input type="file" accept={PROOF_ACCEPT} onChange={e => setReturnProof(acceptProof(e.target.files?.[0]))} />
                      </label>
                    ) : (
                      <div className="esm-file-chip" title={returnProof.name}>
                        <i className="ri-file-text-line esm-file-ic" />
                        <span className="esm-file-name">{returnProof.name}</span>
                        <label className="esm-file-btn" title="Replace"><i className="ri-refresh-line" /><input type="file" hidden accept={PROOF_ACCEPT} onChange={e => setReturnProof(acceptProof(e.target.files?.[0]))} /></label>
                      </div>
                    )}
                  </div>
                  <div className="esm-fld s12">
                    <label>NOTE <span className="esm-muted">(optional)</span></label>
                    <textarea className="esm-in" rows={2} maxLength={500} placeholder="e.g. UPI ref no., who received it…" value={returnNote} onChange={e => setReturnNote(e.target.value)} />
                  </div>
                </div>
              ) : (
                <div className="esm-fgrid">
                  <div className={`esm-fld s6 ${returnErr && !returnRecStart ? 'esm-fld--err' : ''}`}>
                    <label>RECOVERY START <span className="esm-req">*</span> <span className="esm-muted">(next month onward)</span></label>
                    <MasterDatePicker value={returnRecStart} onChange={(v) => setReturnRecStart(v)} minDate={nextMonthDay} placeholder="Select start month" />
                    {returnErr && !returnRecStart && <span className="esm-err">Pick a recovery start month.</span>}
                  </div>
                  <div className={`esm-fld s6 ${returnErr && !returnRecType ? 'esm-fld--err' : ''}`}>
                    <label>RECOVERY TYPE <span className="esm-req">*</span></label>
                    <MasterSelect
                      value={returnRecType}
                      onChange={(v) => { setReturnRecType(v as any); if (v === 'lumpsum' && empSalary != null && empSalary < returnRemaining - 0.005) toast.warning('Salary too low', `Single lump needs a monthly salary of at least ${inr(returnRemaining)}.`); }}
                      options={[
                        { value: 'emi', label: 'EMI — equal monthly instalments' },
                        { value: 'bimonthly', label: 'Bi-Monthly — every alternate month' },
                        { value: 'lumpsum', label: 'Single Lump Sum — one month' + (singleLumpOk ? '' : ' (salary too low)') },
                      ]}
                      placeholder="How to recover from payroll?"
                    />
                    {returnErr && !returnRecType && <span className="esm-err">Select a recovery type.</span>}
                  </div>
                  {returnRecType === 'lumpsum' ? (
                    <div className="esm-fld s12">
                      <div className="esm-choose-note">
                        <i className="ri-information-line" />
                        <span>The full <strong>{inr(returnRemaining)}</strong> will be deducted in <strong>{returnRecStart ? new Date(returnRecStart).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) : 'the start month'}</strong>.{empSalary != null ? ` Monthly salary ${inr(empSalary)}.` : ''}</span>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className={`esm-fld s4 ${returnRow2Locked ? 'is-locked' : ''} ${(returnErr && !returnRow2Locked && !(recMonthlyNum > 0)) || (!returnRow2Locked && returnPerCycleOver) ? 'esm-fld--err' : ''}`} onMouseDownCapture={returnRow2Locked ? (e) => { e.preventDefault(); toastRow2Locked(); } : undefined}>
                        <label>{returnRecType === 'bimonthly' ? 'AMOUNT / CYCLE' : 'MONTHLY AMOUNT'} <span className="esm-req">*</span> <span className="esm-muted">(max {inr(returnEmiCap > 0 ? Math.min(returnEmiCap, returnRemaining) : returnRemaining)}{returnEmiCap > 0 ? ' · EMI headroom' : ''})</span></label>
                        <div className="esm-money"><span className="esm-cur">₹</span>
                          <input className="esm-in" type="number" min={0} placeholder="0.00" value={returnRecMonthly} disabled={returnRow2Locked} onChange={e => setMonthlyFromInput(e.target.value)} />
                        </div>
                        {returnErr && !returnRow2Locked && !(recMonthlyNum > 0) && <span className="esm-err">Enter an amount.</span>}
                        {!returnRow2Locked && returnPerCycleOver && <span className="esm-err">Max {inr(returnEmiCap)} (EMI headroom).</span>}
                        {!returnRow2Locked && !returnPerCycleOver && returnCannotSchedule && <span className="esm-err">Balance too large for payroll — can’t clear in {RET_MAX_MONTHS} within the EMI headroom. Return directly.</span>}
                        {!returnRow2Locked && !returnPerCycleOver && !returnCannotSchedule && returnTenureExceeds && <span className="esm-err">Over {RET_MAX_MONTHS} {returnRecType === 'bimonthly' ? 'cycles' : 'months'} — raise the monthly amount (min {inr(returnMinMonthly)}).</span>}
                      </div>
                      <div className={`esm-fld s4 ${returnRow2Locked ? 'is-locked' : ''} ${returnErr && !returnRow2Locked && !(recMonths > 0) ? 'esm-fld--err' : ''}`} onMouseDownCapture={returnRow2Locked ? (e) => { e.preventDefault(); toastRow2Locked(); } : undefined}>
                        <label>NO. OF {returnRecType === 'bimonthly' ? 'CYCLES' : 'MONTHS'} <span className="esm-req">*</span></label>
                        <input className="esm-in" type="number" min={1} placeholder="e.g. 6" value={returnRecMonths} disabled={returnRow2Locked} onChange={e => setMonthsFromInput(e.target.value)} />
                        {returnErr && !returnRow2Locked && !(recMonths > 0) && <span className="esm-err">Enter a count.</span>}
                      </div>
                      <div className={`esm-fld s4 ${returnRow2Locked ? 'is-locked' : ''}`} onMouseDownCapture={returnRow2Locked ? (e) => { e.preventDefault(); toastRow2Locked(); } : undefined}>
                        <label>END DATE <span className="esm-muted">(auto)</span></label>
                        <input className="esm-in" value={!returnRow2Locked && recMonths > 0 && returnRecStart ? recEndLabel : ''} placeholder="—" readOnly disabled={returnRow2Locked} />
                        {!returnRow2Locked && recMonthlyNum > 0 && recMonths > 0 && recMonthlyNum * recMonths > returnRemaining + 0.005 && (
                          <span className="esm-muted" style={{ marginTop: 4, display: 'inline-block' }}>Last {returnRecType === 'bimonthly' ? 'cycle' : 'month'}: {inr(returnRemaining - recMonthlyNum * (recMonths - 1))}</span>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
            <div className="esm-sub-foot">
              <div className="esm-foot-hint"><i className="ri-information-line" /> {returnStep === 'mode' ? 'Pay directly (instalments) or cut it from payroll.' : returnMode === 'payroll' ? 'Recovered from salary per the schedule; the payroll engine will deduct it.' : `Up to ${inr(returnRemaining)} can be returned.`}</div>
              <div className="esm-foot-r">
                {returnStep === 'mode' ? (
                  <>
                    <button type="button" className="esm-btn-ghost" onClick={() => setReturnOpen(false)}>Cancel</button>
                    <button type="button" className="esm-btn-primary" disabled={!returnMode} onClick={() => setReturnStep('form')}>Continue</button>
                  </>
                ) : (
                  <>
                    <button type="button" className="esm-btn-ghost" onClick={() => setReturnStep('mode')} disabled={returnSaving}>Back</button>
                    <button type="button" className="esm-btn-primary" disabled={returnSaving || (returnMode === 'payroll' && ((returnRecType === 'lumpsum' && !singleLumpOk) || (returnRecType !== 'lumpsum' && (returnPerCycleOver || returnCannotSchedule || returnTenureExceeds))))} onClick={submitReturn}>{returnSaving ? 'Saving…' : returnMode === 'payroll' ? 'Schedule payroll recovery' : 'Record payment'}</button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Approve / Reject confirmation ── */}
      {confirmKind && summary && (
        <div className="esm-sub-backdrop" onMouseDown={() => { if (!saving) setConfirmKind(null); }}>
          <div className="esm-confirm" onMouseDown={e => e.stopPropagation()} role="dialog" aria-modal="true">
            <span className={`esm-confirm-ico ${confirmKind === 'approve' ? 'is-approve' : 'is-reject'}`}>
              <i className={confirmKind === 'approve' ? 'ri-checkbox-circle-line' : 'ri-close-circle-line'} />
            </span>
            <div className="esm-confirm-title">{confirmKind === 'approve' ? `Approve this ${noun}?` : `Reject this ${noun}?`}</div>
            {confirmKind === 'approve' ? (
              managerReview ? (
                <div className="esm-confirm-msg">
                  This forwards the {noun} to <b>HR / Finance</b> for settlement. As the reporting manager you’re approving the {noun} only — deductions &amp; payment happen at the next stage.
                </div>
              ) : (
                <div className="esm-confirm-msg">
                  Net payable <b>{inr(sanctioned)}</b> will be locked. <b>Once approved, the sanctioned amount can’t be changed</b> — only payments can be recorded.
                </div>
              )
            ) : (
              <>
                <div className="esm-confirm-msg">This will reject{' '}
                  {/* Truncate a long claim name so it can't overflow the
                      confirm popup — full name on hover via title. */}
                  <b
                    title={summary.title || summary.claim_no || ''}
                    style={{ display: 'inline-block', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', verticalAlign: 'bottom' }}
                  >{summary.title || summary.claim_no}</b>. Please provide a reason.</div>
                <textarea
                  className="esm-in"
                  rows={3}
                  placeholder="Reason for rejection…"
                  value={rejectReason}
                  maxLength={1000}
                  onChange={e => setRejectReason(e.target.value)}
                  autoFocus
                />
                {/* Live character counter — mirrors the backend max:1000 cap
                    so the user can see how much room is left. */}
                <div style={{ textAlign: 'right', fontSize: 11, color: rejectReason.length >= 1000 ? '#dc2626' : '#6b7280', marginTop: 2 }}>
                  {rejectReason.length}/1000
                </div>
              </>
            )}
            <div className="esm-confirm-actions">
              {confirmKind === 'approve' ? (
                <button className="esm-btn-approve" onClick={reviewApprove} disabled={saving}>{saving ? 'Approving…' : 'Confirm Approve'}</button>
              ) : (
                <button className="esm-btn-reject" onClick={reviewReject} disabled={saving || !rejectReason.trim()}>{saving ? 'Rejecting…' : 'Confirm Reject'}</button>
              )}
              <button className="esm-btn-ghost" onClick={() => setConfirmKind(null)} disabled={saving}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}

const CSS = `
.esm-backdrop{position:fixed;inset:0;z-index:9000;background:rgba(15,23,42,.55);backdrop-filter:blur(2px);display:flex;align-items:center;justify-content:center;padding:20px;}
.esm-modal{width:100%;max-width:1360px;min-height:min(720px,94vh);max-height:94vh;display:flex;flex-direction:column;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 28px 70px rgba(2,44,52,.4);font-family:inherit;}
/* Review mode fits its content instead of forcing the tall min-height, with
   even spacing around the content on all four sides. */
.esm-modal--fit{min-height:0;}
/* Fit mode still fits SHORT content, but a tall body (e.g. Review & Approve with
   several adjustment rows) must scroll inside the 94vh cap instead of being
   clipped by the modal's overflow:hidden — otherwise the footer (Approve/Reject)
   is unreachable. flex:1 1 auto + min-height:0 lets the body shrink and scroll. */
.esm-modal--fit .esm-body{flex:1 1 auto;min-height:0;overflow-y:auto;padding:22px;}
.esm-modal--fit .esm-hero{padding-bottom:0;}
/* Manager review is just the Claim Details card — sit it tight under the header,
   with a divider line at the bottom of the header (no read-only panel here). */
/* Reporting-manager review popup only — give the Claim Details card more
   breathing room below the hero (scoped to esm-modal--fit-mgr, which is applied
   only when the claim is at the manager-approval stage). */
.esm-modal--fit-mgr .esm-body{padding-top:6px;}
.esm-modal--fit-mgr .esm-hero{border-bottom:4px solid rgba(255,255,255,.6);}
/* Give the header title block room below its subtitle (the hero's own
   bottom padding is zeroed by .esm-modal--fit). */
.esm-modal--fit-mgr .esm-hero-top{padding-bottom:14px;}
[data-bs-theme="dark"] .esm-modal{background:#0b1e27;color:#e2e8f0;}
/* Nested Add-Payment popup (over the overview) — styled like the PO "Update PO
   Payment" dialog: teal header + outstanding-balance strip + form. */
.esm-sub-backdrop{position:fixed;inset:0;z-index:9600;background:rgba(15,23,42,.5);backdrop-filter:blur(2px);display:flex;align-items:center;justify-content:center;padding:20px;}
.esm-sub-modal{width:100%;max-width:1080px;max-height:92vh;display:flex;flex-direction:column;background:#fff;border:1.5px solid rgba(255,255,255,.5);border-radius:16px;overflow:hidden;box-shadow:0 30px 80px rgba(15,23,42,.5);}
.esm-sub-modal--settle{max-width:980px;}
[data-bs-theme="dark"] .esm-sub-modal{background:#0f172a;color:#e2e8f0;}
.esm-sub-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 20px;background:linear-gradient(120deg,#0e7490,#06b6d4);color:#fff;}
.esm-sub-head-l{display:flex;align-items:center;gap:12px;min-width:0;}
.esm-sub-head-ico{width:34px;height:34px;border-radius:9px;background:rgba(255,255,255,.18);display:inline-flex;align-items:center;justify-content:center;font-size:17px;flex-shrink:0;}
.esm-sub-title{font-size:15px;font-weight:800;}
.esm-sub-hsub{font-size:11.5px;color:rgba(255,255,255,.9);display:flex;align-items:center;gap:7px;margin-top:2px;}
.esm-sub-chip{font-family:monospace;font-weight:700;background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.3);padding:2px 8px;border-radius:20px;}
.esm-sub-dot{opacity:.7;}
.esm-sub-x{width:30px;height:30px;border-radius:8px;border:none;background:rgba(255,255,255,.16);color:#fff;cursor:pointer;font-size:15px;flex-shrink:0;}
.esm-sub-x:hover{background:rgba(255,255,255,.3);}
.esm-sub-body{padding:18px 20px;overflow-y:auto;flex:1;display:flex;flex-direction:column;gap:16px;}
.esm-sub-foot{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 20px;border-top:1px solid #eef2f4;background:#f8fafc;}
[data-bs-theme="dark"] .esm-sub-foot{background:#0b1a22;border-color:#173947;}
/* Outstanding-balance strip */
.esm-bal{display:flex;flex-wrap:wrap;align-items:center;gap:10px 14px;background:linear-gradient(120deg,#ecfeff,#f0fdfa);border:1px solid #cffafe;border-radius:12px;padding:14px 16px;}
[data-bs-theme="dark"] .esm-bal{background:linear-gradient(120deg,#0e2730,#0d2620);border-color:rgba(6,182,212,.28);}
.esm-bal-ico{width:42px;height:42px;border-radius:11px;background:linear-gradient(135deg,#f59e0b,#d97706);color:#fff;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;}
.esm-bal-txt{flex:1 1 190px;min-width:170px;}
.esm-bal-lab{font-size:9.5px;font-weight:700;letter-spacing:.06em;color:#0891b2;white-space:nowrap;}
.esm-bal-val{font-size:21px;font-weight:800;color:#0f172a;white-space:nowrap;line-height:1.2;}
[data-bs-theme="dark"] .esm-bal-val{color:#e2e8f0;}
.esm-bal-chips{display:flex;gap:8px;flex-wrap:wrap;flex:1 1 auto;justify-content:flex-end;}
.esm-bal-chip{font-size:11px;font-weight:700;color:#334155;background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:7px 12px;white-space:nowrap;}
[data-bs-theme="dark"] .esm-bal-chip{background:#1e293b;border-color:rgba(148,163,184,.2);color:#cbd5e1;}
.esm-bal-chip.is-net{border-color:#7dd3e0;color:#0e7490;background:#f0fdff;}
[data-bs-theme="dark"] .esm-bal-chip.is-net{background:#0e2730;color:#67e8f9;border-color:rgba(6,182,212,.4);}
/* Add-Payment form — 12-col grid: row1 4·4·4, row2 4·8, row3 12 */
.esm-fgrid{display:grid;grid-template-columns:repeat(12,1fr);gap:16px 18px;}
.esm-fgrid .s4{grid-column:span 4;}
.esm-fgrid .s6{grid-column:span 6;}
.esm-fgrid .s8{grid-column:span 8;}
.esm-fgrid .s12{grid-column:span 12;}
@media (max-width:760px){.esm-fgrid .s4,.esm-fgrid .s6,.esm-fgrid .s8{grid-column:span 12;}}
/* Inline field errors — red mark on the offending field (no toast). */
.esm-err{font-size:11px;font-weight:600;color:#ef4444;}
.esm-fld--err .esm-in,.esm-fld--err .esm-money .esm-in{border-color:#ef4444;background:#fff7f7;}
.esm-fld--err .esm-in:focus{box-shadow:0 0 0 3px rgba(239,68,68,.14);}
.esm-fld--err .esm-file{border-color:#ef4444;background:#fff7f7;color:#e11d48;}
[data-bs-theme="dark"] .esm-fld--err .esm-in,[data-bs-theme="dark"] .esm-fld--err .esm-file{background:#2a0f16;border-color:#e11d48;}
.esm-note-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:2px;}
.esm-note-count{font-size:10.5px;color:#94a3b8;font-weight:600;margin-left:auto;}
/* Amount-to-pay currency input (form cell — must NOT inherit the deduction
   row's flex-basis, which would make it 150px tall inside the column layout). */
.esm-money{position:relative;display:flex;align-items:center;}
.esm-money .esm-cur{position:absolute;left:11px;color:#64748b;font-size:13px;pointer-events:none;}
.esm-money .esm-in{padding-left:24px;}
/* Expense-type radio pair */
/* Plain (borderless) radios — Goods / Service */
.esm-radio-row{display:flex;align-items:center;gap:22px;min-height:41px;}
.esm-radio{display:inline-flex;align-items:center;gap:8px;font-size:13px;font-weight:600;color:#475569;cursor:pointer;}
.esm-radio input{width:16px;height:16px;accent-color:#0891b2;margin:0;cursor:pointer;flex-shrink:0;}
.esm-radio.is-on{color:#0e7490;}
[data-bs-theme="dark"] .esm-radio{color:#cbd5e1;}
[data-bs-theme="dark"] .esm-radio.is-on{color:#67e8f9;}
[data-bs-theme="dark"] .esm-radio{background:#0b2029;border-color:#173947;color:#cbd5e1;}
[data-bs-theme="dark"] .esm-radio.is-on{background:#0e2730;border-color:#0891b2;color:#67e8f9;}
.esm-hero{display:flex;flex-direction:column;gap:16px;padding:22px 28px;background:linear-gradient(120deg,#0e7490 0%,#0891b2 55%,#06b6d4 100%);color:#fff;flex-shrink:0;}
.esm-hero-top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;}
.esm-hero-l{display:flex;align-items:center;gap:14px;min-width:0;}
/* Embedded claim summary panel. Left edge indented past the hero icon so it
   lines up under the "Settle…" text; right edge stops at the close (×) button's
   left edge (32px button + a small gap). */
.esm-hpanel{display:grid;grid-template-columns:repeat(4,1fr);gap:14px 20px;margin-left:62px;margin-right:40px;background:rgba(255,255,255,.10);border:1px solid rgba(255,255,255,.18);border-radius:14px;padding:14px 18px;}
/* Emphasised bottom divider + spacing only in the review popup. */
.esm-modal--fit .esm-hpanel{border-bottom:2px solid rgba(255,255,255,.45);margin-bottom:16px;}
.esm-hp{min-width:0;}
.esm-hp label{display:block;font-size:9.5px;font-weight:800;letter-spacing:.08em;opacity:.8;text-transform:uppercase;margin-bottom:3px;}
.esm-hp>div{font-size:14px;font-weight:800;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.esm-hp-proof{grid-column:span 2;}
.esm-hp-none{font-size:12px;font-weight:600;opacity:.75;}
.esm-hp-docs{display:flex;flex-wrap:wrap;gap:6px;}
.esm-hp-doc{display:inline-flex;align-items:center;gap:6px;max-width:100%;padding:5px 10px;border-radius:8px;background:rgba(255,255,255,.16);color:#fff;text-decoration:none;font-size:12px;font-weight:600;border:none;font-family:inherit;}
.esm-hp-doc:hover{background:rgba(255,255,255,.28);}
.esm-hp-doc a{color:inherit;text-decoration:none;display:inline-flex;align-items:center;}
.esm-hp-doc-name{max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.esm-hp-doc-act{opacity:.82;flex-shrink:0;}
.esm-hp-doc-act:hover{opacity:1;}
.esm-hp-more{cursor:pointer;background:rgba(255,255,255,.24);font-weight:700;}
.esm-hp-more:hover{background:rgba(255,255,255,.36);}
@media (max-width:820px){.esm-hpanel{grid-template-columns:repeat(2,1fr);margin-left:0;margin-right:0;}.esm-hp-proof{grid-column:span 2;}}
@media (max-width:480px){.esm-hpanel{grid-template-columns:1fr;}.esm-hp-proof{grid-column:span 1;}}
.esm-hero-ico{width:48px;height:48px;border-radius:12px;background:rgba(255,255,255,.18);display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;}
.esm-hero-eyebrow{font-size:10.5px;font-weight:800;letter-spacing:.09em;opacity:.85;margin-bottom:2px;}
.esm-hero-title{font-size:20px;font-weight:800;line-height:1.15;}
/* A long expense title used to stretch the whole header (QA). Cap it with an
   ellipsis; the full title stays available on hover (title attr). */
.esm-hero-sub-inline{font-weight:600;opacity:.9;display:inline-block;max-width:min(60vw,760px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:bottom;}
.esm-hero-sub{font-size:12px;opacity:.85;margin-top:3px;}
.esm-x{width:32px;height:32px;border-radius:9px;border:none;background:rgba(255,255,255,.16);color:#fff;font-size:14px;cursor:pointer;flex-shrink:0;}
.esm-x:hover{background:rgba(255,255,255,.3);}
/* Stage nav */
.esm-steps{display:flex;align-items:stretch;gap:10px;padding:16px 28px;background:#ecfeff;}
[data-bs-theme="dark"] .esm-steps{background:#0d2730;}
.esm-stepcard{flex:1;display:flex;align-items:center;gap:12px;padding:12px 16px;border-radius:14px;background:#fff;border:1.5px solid #e2eef2;opacity:.75;}
[data-bs-theme="dark"] .esm-stepcard{background:#0b2029;border-color:#173947;}
.esm-stepcard.is-active{opacity:1;border-color:#0891b2;border-top:3px solid #10b981;box-shadow:0 3px 14px rgba(8,145,178,.15);}
.esm-stepcard.is-done{opacity:1;}
.esm-steptxt{min-width:0;}
.esm-stepnum{width:34px;height:34px;border-radius:50%;background:#0891b2;color:#fff;font-weight:800;font-size:14px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;}
.esm-stepcard:not(.is-active):not(.is-done) .esm-stepnum{background:#94a3b8;}
.esm-step-eyebrow{display:flex;align-items:center;gap:8px;font-size:10px;font-weight:800;letter-spacing:.08em;color:#0891b2;}
.esm-stepcard:not(.is-active) .esm-step-eyebrow{color:#94a3b8;}
.esm-active-pill{background:#dcfce7;color:#15803d;border-radius:999px;padding:1px 8px;font-size:9px;font-weight:800;letter-spacing:.04em;}
.esm-steptitle{font-size:14px;font-weight:800;color:#0c4a6e;line-height:1.2;margin-top:1px;}
[data-bs-theme="dark"] .esm-steptitle{color:#cffafe;}
.esm-stepdesc{font-size:11px;color:#64748b;}
.esm-step-chev{align-self:center;color:#67c8db;font-size:22px;font-weight:700;flex-shrink:0;}
.esm-body{padding:22px 28px;overflow-y:auto;flex:1;}
.esm-loading{text-align:center;color:#64748b;padding:30px 0;}
.esm-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;}
.esm-grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:14px 20px;}
@media (max-width:720px){.esm-grid3{grid-template-columns:1fr 1fr;}}
@media (max-width:480px){.esm-grid3{grid-template-columns:1fr;}}
/* 12-column grid — row1: 3·3·3·3, row2: 3·3·6 (proof) */
.esm-grid12{display:grid;grid-template-columns:repeat(12,1fr);gap:14px 20px;align-items:start;}
.esm-grid12 .c3{grid-column:span 3;}
.esm-grid12 .c4{grid-column:span 4;}
.esm-grid12 .c6{grid-column:span 6;}
.esm-grid12 .c12{grid-column:span 12;}
@media (max-width:720px){.esm-grid12 .c3,.esm-grid12 .c4{grid-column:span 6;}.esm-grid12 .c6{grid-column:span 12;}}
@media (max-width:480px){.esm-grid12 .c3,.esm-grid12 .c4,.esm-grid12 .c6{grid-column:span 12;}}
.esm-divider{height:1px;background:#eef2f4;margin:4px 0 2px;}
[data-bs-theme="dark"] .esm-divider{background:#173947;}
.esm-col2{grid-column:1 / -1;}
.esm-fld,.esm-ro{display:flex;flex-direction:column;gap:5px;min-width:0;}
.esm-fld>label,.esm-ro>label,.esm-card>label,.esm-card-lbl,.esm-card-hd label{font-size:10.5px;font-weight:700;letter-spacing:.03em;color:#64748b;text-transform:uppercase;}
.esm-ro-sm{font-size:13px;font-weight:600;}
.esm-req{color:#ef4444;}
.esm-ro-v{font-size:14px;font-weight:700;color:#0f172a;}
[data-bs-theme="dark"] .esm-ro-v{color:#e2e8f0;}
.esm-ro-v.is-neg,.is-neg{color:#e11d48;}
.esm-ro-v.is-pos,.is-pos{color:#059669;}
.esm-ro-v.is-warn{color:#b45309;}
/* Free-text values (purpose / description). New claims are capped at 500 chars,
   but rows filed before that cap can be arbitrarily long — clamp them to a few
   lines with their own scrollbar, and break unspaced strings, so one verbose
   claim can't stretch this grid apart (CBC #57). */
.esm-ro-v--text{max-height:76px;overflow-y:auto;overflow-wrap:anywhere;font-weight:600;line-height:1.45;}
.esm-in{width:100%;border:1.5px solid #dbe7ec;border-radius:10px;padding:9px 12px;font-size:13px;font-family:inherit;color:#0f172a;background:#fff;outline:none;transition:border-color .15s,box-shadow .15s;}
.esm-in:focus{border-color:#22d3ee;box-shadow:0 0 0 3px rgba(34,211,238,.14);}
[data-bs-theme="dark"] .esm-in{background:#0b2029;border-color:#173947;color:#e2e8f0;}
textarea.esm-in{resize:vertical;}
.esm-inline{display:flex;gap:8px;align-items:stretch;}
.esm-inline .esm-in{flex:1;}
.esm-plus{width:40px;flex-shrink:0;border:1.5px solid #dbe7ec;border-radius:10px;background:#f1f5f9;color:#0891b2;font-size:16px;font-weight:700;cursor:pointer;}
.esm-plus:hover{background:#e0f2fe;}
.esm-addbtn{flex-shrink:0;border:none;border-radius:10px;background:#0891b2;color:#fff;font-weight:700;font-size:13px;padding:0 16px;cursor:pointer;}
.esm-addbtn:disabled{opacity:.5;cursor:not-allowed;}
.esm-hint{font-size:11.5px;color:#94a3b8;}
.esm-muted{color:#94a3b8;}
/* Read-only value styled like an input box (Net payable) */
.esm-ro-static{width:100%;border:1.5px solid #dbe7ec;border-radius:10px;padding:9px 12px;font-size:14px;font-weight:800;color:#0891b2;background:#f0fdff;}
[data-bs-theme="dark"] .esm-ro-static{background:#0b2029;border-color:#173947;color:#67e8f9;}
/* Proof-of-payment file picker */
.esm-file{display:flex;align-items:center;gap:8px;min-height:41px;margin:0;box-sizing:border-box;border:1.5px dashed #b6d9e2;border-radius:10px;padding:0 12px;font-size:12.5px;font-weight:600;color:#0891b2;background:#f8feff;cursor:pointer;}
.esm-file:hover{background:#ecfeff;border-color:#22d3ee;}
.esm-file i{font-size:15px;}
.esm-file input{display:none;}
[data-bs-theme="dark"] .esm-file{background:#0b2029;border-color:#173947;color:#67e8f9;}
.esm-file-chip{display:flex;align-items:center;gap:8px;min-height:41px;border:1.5px solid #dbe7ec;border-radius:10px;padding:0 6px 0 12px;font-size:12.5px;font-weight:600;color:#0c4a6e;background:#f8fafc;}
.esm-file-ic{color:#0891b2;flex-shrink:0;}
.esm-file-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.esm-file-act{width:30px;height:30px;flex-shrink:0;margin:0;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;border:1.5px solid #cbeef4;border-radius:8px;background:#fff;color:#0891b2;font-size:15px;line-height:1;cursor:pointer;transition:background .15s,border-color .15s;}
.esm-file-act:hover{background:#ecfeff;border-color:#22d3ee;}
.esm-file-act input{display:none;}
[data-bs-theme="dark"] .esm-file-act{background:#0b2029;border-color:#173947;color:#67e8f9;}
.esm-file-act--danger{border-color:#fecdd3;background:#fff1f2;color:#e11d48;}
.esm-file-act--danger:hover{background:#ffe4e6;border-color:#fda4af;}
[data-bs-theme="dark"] .esm-file-act--danger{background:#2a0f16;border-color:#5b2130;color:#fca5a5;}
/* Labeled file actions — View / Download / Reupload.
 * margin:0 is required: Reupload is a <label> and the global Velzon reboot puts
 * margin-bottom on every label, which pushed it up out of line with the two
 * <button> siblings in this centered flex row. */
.esm-file-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;flex-shrink:0;height:30px;line-height:1;margin:0;box-sizing:border-box;border:1.5px solid #cbeef4;border-radius:8px;background:#fff;color:#0891b2;font-size:12px;font-weight:700;padding:0 11px;cursor:pointer;white-space:nowrap;transition:background .15s,border-color .15s;}
.esm-file-btn i{font-size:14px;line-height:1;}
.esm-file-btn:hover{background:#ecfeff;border-color:#22d3ee;}
.esm-file-btn:disabled{opacity:.6;cursor:default;background:#fff;border-color:#cbeef4;}
.esm-file-btn input{display:none;}
[data-bs-theme="dark"] .esm-file-btn{background:#0b2029;border-color:#173947;color:#67e8f9;}
.esm-file-x{width:28px;height:28px;flex-shrink:0;border:1.5px solid #fecdd3;border-radius:8px;background:#fff1f2;color:#e11d48;font-size:11px;cursor:pointer;}
.esm-file-x:hover{background:#ffe4e6;}
[data-bs-theme="dark"] .esm-file-chip{background:#0b2029;border-color:#173947;color:#cffafe;}
[data-bs-theme="dark"] .esm-file-x{background:#2a0f16;border-color:#5b2130;color:#fca5a5;}
/* Cards — each Step-1 section sits in its own bordered card for a clean layout */
.esm-card{margin-top:16px;border:1.5px solid #e6eef2;border-left:4px solid #0891b2;border-radius:14px;padding:14px 16px;background:#fbfeff;display:flex;flex-direction:column;gap:10px;}
.esm-card--top{margin-top:0;border-left:1.5px solid #e6eef2;}
[data-bs-theme="dark"] .esm-card{background:#0c232c;border-color:#173947;border-left-color:#0891b2;}
[data-bs-theme="dark"] .esm-card--top{border-left-color:#173947;}
.esm-card-hd{display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #eef4f6;padding-bottom:8px;}
[data-bs-theme="dark"] .esm-card-hd{border-color:#173947;}
/* Section card (Payment History / Payment Details) — left accent + header band */
/* Section cards — exact styling from the PO "Payment Summary" modal (pop-sec). */
.esm-sec{position:relative;margin-top:16px;background:#fff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;box-shadow:0 2px 10px rgba(15,23,42,.04);}
[data-bs-theme="dark"] .esm-sec{background:#0c232c;border-color:#173947;}
.esm-sec::before{content:'';position:absolute;left:0;top:0;bottom:0;width:4px;z-index:5;background:linear-gradient(180deg,#22d3ee,#0891b2,#0e7490);}
.esm-sec-hd{position:relative;overflow:hidden;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 16px;background:linear-gradient(110deg,#f0fdff 0%,#e8fbfd 25%,#cffafe 55%,#bff0f7 85%,#a5e9f3 100%);border-bottom:1px solid #9ce1ee;box-shadow:0 2px 0 rgba(255,255,255,.85) inset;}
[data-bs-theme="dark"] .esm-sec-hd{background:#0d2730;border-color:#173947;box-shadow:none;}
.esm-sec-hd::before{content:'';position:absolute;top:0;left:0;right:0;height:50%;pointer-events:none;background:linear-gradient(180deg,rgba(255,255,255,.5),transparent);}
.esm-sec-hd::after{content:'';position:absolute;inset:0;pointer-events:none;background-image:radial-gradient(ellipse at 10% 50%,rgba(103,232,249,.45) 0%,transparent 50%),radial-gradient(ellipse at 90% 50%,rgba(34,211,238,.28) 0%,transparent 55%);}
[data-bs-theme="dark"] .esm-sec-hd::before,[data-bs-theme="dark"] .esm-sec-hd::after{display:none;}
.esm-sec-l{position:relative;z-index:1;display:flex;align-items:center;gap:11px;}
.esm-sec-hd>.esm-sec-ico{position:relative;z-index:1;}
.esm-sec-ico{width:32px;height:32px;border-radius:10px;background:linear-gradient(135deg,#06b6d4 0%,#0891b2 55%,#0e7490 100%);display:inline-flex;align-items:center;justify-content:center;color:#fff;flex-shrink:0;box-shadow:0 0 0 2.5px rgba(6,182,212,.22),0 3px 10px rgba(8,145,178,.4);font-size:15px;}
.esm-sec-tt{min-width:0;flex:1;position:relative;z-index:1;}
.esm-sec-title-row{display:flex;align-items:center;gap:7px;flex-wrap:wrap;}
.esm-sec-tag{font-size:10.5px;font-weight:700;color:#0891b2;letter-spacing:.02em;}
.esm-sec-div{color:#7dd3e0;font-weight:400;}
.esm-sec-title{font-size:13.5px;font-weight:800;color:#0c4a6e;letter-spacing:-.01em;}
[data-bs-theme="dark"] .esm-sec-title{color:#cffafe;}
.esm-sec-sub{font-size:10.5px;color:#0e7490;margin-top:2px;}
[data-bs-theme="dark"] .esm-sec-sub{color:#67c8db;}
.esm-sec-badge{position:relative;z-index:1;flex-shrink:0;background:#fff;border:1px solid #cffafe;color:#0891b2;border-radius:999px;padding:4px 12px;font-size:11px;font-weight:700;white-space:nowrap;}
[data-bs-theme="dark"] .esm-sec-badge{background:#0b2029;border-color:#173947;color:#67e8f9;}
.esm-sec-badge--lock{background:#f1f5f9;border-color:#e2e8f0;color:#64748b;display:inline-flex;align-items:center;gap:4px;}
[data-bs-theme="dark"] .esm-sec-badge--lock{background:#0b2029;border-color:#173947;color:#94a3b8;}
.esm-sec-body{padding:14px 16px;background:linear-gradient(180deg,#f0fdff 0%,#f8fafc 100%);}
[data-bs-theme="dark"] .esm-sec-body{background:#0c232c;}
/* Section header right-side actions (+ Add Payment) */
.esm-sec-hd-actions{position:relative;z-index:1;display:flex;align-items:center;gap:10px;flex-shrink:0;}
.esm-sec-btn{border:none;border-radius:8px;padding:8px 16px;font-size:12px;font-weight:700;cursor:pointer;color:#fff;background:linear-gradient(135deg,#0c4a6e,#0e7490);box-shadow:0 3px 10px rgba(14,116,144,.3);white-space:nowrap;display:inline-flex;gap:6px;align-items:center;}
.esm-sec-btn:hover:not(:disabled){filter:brightness(1.09);}
.esm-sec-btn--sm{padding:6px 12px;font-size:11.5px;box-shadow:0 2px 6px rgba(14,116,144,.28);}
.esm-settle-addmore{margin-top:10px;width:100%;display:inline-flex;align-items:center;justify-content:center;gap:6px;border:1.5px dashed #22d3ee;background:#ecfeff;color:#0891b2;border-radius:9px;padding:9px 14px;font-size:12.5px;font-weight:700;cursor:pointer;}
.esm-settle-addmore:hover{background:#cffafe;}
[data-bs-theme="dark"] .esm-settle-addmore{background:rgba(8,145,178,.14);border-color:rgba(8,145,178,.5);color:#67e8f9;}
.esm-settle-addmore--reimb{margin-top:12px;border-style:solid;border-color:#06b6d4;background:linear-gradient(135deg,#0891b2,#06b6d4);color:#fff;}
.esm-settle-addmore--reimb:hover:not(:disabled){filter:brightness(1.07);background:linear-gradient(135deg,#0891b2,#06b6d4);}
.esm-settle-addmore--reimb:disabled{opacity:.6;cursor:not-allowed;}
.esm-reimb-done{margin-top:12px;display:flex;align-items:center;gap:8px;background:#d6f4e3;border:1px solid #a7e3c2;color:#108548;border-radius:9px;padding:10px 14px;font-size:12.5px;font-weight:600;}
.esm-reimb-done i{font-size:16px;}
[data-bs-theme="dark"] .esm-reimb-done{background:rgba(16,133,72,.18);border-color:rgba(16,133,72,.5);color:#6ee7b7;}
.esm-sec-btn:disabled{opacity:.5;cursor:not-allowed;box-shadow:none;}
/* Collapse chevron */
.esm-recap{font-size:11.5px;font-weight:700;color:#0e7490;background:#ecfeff;border:1px solid #a5e9f3;border-radius:999px;padding:5px 12px;white-space:nowrap;}
.esm-recap-k{color:#64748b;font-weight:600;}
.esm-recap-dot{margin:0 7px;color:#94a3b8;}
[data-bs-theme="dark"] .esm-recap{background:#0b2029;border-color:#173947;color:#67e8f9;}
@media (max-width:640px){.esm-recap{display:none;}}
.esm-sec-chev{width:28px;height:28px;border-radius:50%;border:1px solid #cffafe;background:#fff;color:#0e7490;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;font-size:17px;box-shadow:0 1px 3px rgba(6,182,212,.18);flex-shrink:0;}
.esm-sec-chev:hover{background:#ecfeff;}
.esm-sec-chev i{transition:transform .2s ease;}
.esm-sec-chev.is-collapsed i{transform:rotate(-90deg);}
[data-bs-theme="dark"] .esm-sec-chev{background:#0b2029;border-color:#173947;color:#67e8f9;}
/* Deductions 2-col body: left rows, right net-payable summary */
.esm-ded-split{display:flex;gap:16px;align-items:stretch;}
.esm-ded-l{flex:7;min-width:0;display:flex;flex-direction:row;align-items:stretch;gap:16px;}
.esm-ded-r{flex:3;min-width:0;display:flex;flex-direction:column;}
/* Standing line between the additions & deductions columns */
.esm-vline{width:1px;flex-shrink:0;background:#e2e8f0;align-self:stretch;}
[data-bs-theme="dark"] .esm-vline{background:#173947;}
.esm-ded-r .esm-sumbox{margin-top:0;height:100%;display:flex;flex-direction:column;}
.esm-ded-r .esm-sumrow.is-grand{margin-top:auto;}
@media (max-width:720px){.esm-ded-split{flex-direction:column;}.esm-ded-l,.esm-ded-r{flex:1 1 auto;width:100%;}}
.esm-ded-hd{display:flex;align-items:center;justify-content:space-between;}
.esm-ded-hd-lbl{font-size:10.5px;font-weight:700;letter-spacing:.03em;color:#64748b;text-transform:uppercase;}
/* Additions / deductions boxes — side by side on the left */
.esm-adj{flex:1;min-width:0;border:1px solid #eef2f7;border-radius:10px;padding:10px 12px;background:#fbfeff;display:flex;flex-direction:column;gap:8px;}
.esm-adj--add{border-left:3px solid #10b981;}
.esm-adj--ded{border-left:3px solid #f43f5e;}
@media (max-width:820px){.esm-ded-l{flex-direction:column;}.esm-vline{display:none;}}
[data-bs-theme="dark"] .esm-adj{background:#0c232c;border-color:#173947;border-left-color:#10b981;}
[data-bs-theme="dark"] .esm-adj--ded{border-left-color:#f43f5e;}
.esm-add-lbl{color:#059669;}
.esm-add-btn{border-color:#86efac;background:#ecfdf5;color:#059669;}
.esm-add-btn:hover{background:#d1fae5;}
/* Submit-deduction action row under the 2-col body */
.esm-sec-actions{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-top:8px;padding-top:8px;border-top:1px solid #eef4f6;}
[data-bs-theme="dark"] .esm-sec-actions{border-color:#173947;}
.esm-sec-actions-hint{font-size:11.5px;font-weight:700;color:#475569;text-align:left;}
[data-bs-theme="dark"] .esm-sec-actions-hint{color:#cbd5e1;}
/* Bold Submit (lock deduction) button */
.esm-btn-submit{border:none;border-radius:9px;padding:8px 26px;font-size:13.5px;font-weight:800;letter-spacing:.02em;cursor:pointer;color:#fff;background:linear-gradient(120deg,#059669,#0891b2);box-shadow:0 4px 12px rgba(5,150,105,.32);}
.esm-btn-submit:hover{filter:brightness(1.06);}
.esm-btn-submit:disabled{opacity:.55;cursor:not-allowed;box-shadow:none;}
/* KPI strip — exact styling/colors from the PO "Payment Summary" modal */
.esm-kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;}
.esm-kpis--4{grid-template-columns:repeat(4,1fr);}
.esm-kpi{min-width:0;background:#fff;border:1px solid #eef2f7;border-radius:14px;padding:6px 13px;display:flex;gap:10px;align-items:center;border-left:4px solid #94a3b8;box-shadow:0 4px 13px rgba(15,23,42,.06);}
[data-bs-theme="dark"] .esm-kpi{background:#0c232c;border-color:#173947;}
.esm-kpi-txt{min-width:0;flex:1;}
.esm-kpi-ico{width:38px;height:38px;border-radius:11px;display:inline-flex;align-items:center;justify-content:center;color:#fff;flex-shrink:0;}
.esm-kpi-ico svg{width:18px;height:18px;}
.esm-kpi-teal{border-left-color:#06b6d4;} .esm-kpi-teal .esm-kpi-ico{background:linear-gradient(135deg,#22d3ee,#0891b2);box-shadow:0 7px 16px rgba(8,145,178,.38);}
.esm-kpi-green{border-left-color:#10b981;} .esm-kpi-green .esm-kpi-ico{background:linear-gradient(135deg,#34d399,#059669);box-shadow:0 7px 16px rgba(5,150,105,.34);}
.esm-kpi-amber{border-left-color:#f59e0b;} .esm-kpi-amber .esm-kpi-ico{background:linear-gradient(135deg,#fbbf24,#d97706);box-shadow:0 7px 16px rgba(217,119,6,.34);}
.esm-kpi-blue{border-left-color:#6366f1;} .esm-kpi-blue .esm-kpi-ico{background:linear-gradient(135deg,#818cf8,#4f46e5);box-shadow:0 7px 16px rgba(79,70,229,.34);}
.esm-kpi-rose{border-left-color:#f43f5e;} .esm-kpi-rose .esm-kpi-ico{background:linear-gradient(135deg,#fb7185,#e11d48);box-shadow:0 7px 16px rgba(225,29,72,.32);}
.esm-kpi-lab{font-size:9.5px;font-weight:700;letter-spacing:.05em;color:#5c7d9e;}
.esm-kpi-val{font-size:18px;font-weight:800;color:#123a5e;margin:1px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
[data-bs-theme="dark"] .esm-kpi-val{color:#e2e8f0;}
.esm-kpi-sub{font-size:10.5px;color:#7b96ad;font-weight:500;}
@media (max-width:720px){.esm-kpis{grid-template-columns:repeat(2,1fr);}}
@media (max-width:440px){.esm-kpis{grid-template-columns:1fr;}}
/* Payment progress bar */
.esm-prog2{margin-bottom:14px;}
.esm-prog2--band{margin-top:16px;margin-bottom:0;background:#f7feff;border:1px solid #e3eef2;border-radius:14px;padding:14px 18px;}
[data-bs-theme="dark"] .esm-prog2--band{background:#0c232c;border-color:#173947;}
.esm-prog2-hd{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:6px;}
.esm-prog2-lbl{font-size:11px;font-weight:800;letter-spacing:.05em;color:#0c4a6e;text-transform:uppercase;}
[data-bs-theme="dark"] .esm-prog2-lbl{color:#cffafe;}
.esm-prog2-meta{font-size:12px;font-weight:700;color:#0891b2;}
.esm-prog2-track{height:8px;border-radius:999px;background:#e2eef2;overflow:hidden;}
[data-bs-theme="dark"] .esm-prog2-track{background:#123642;}
.esm-prog2-fill{height:100%;border-radius:999px;background:linear-gradient(90deg,#10b981,#06b6d4);transition:width .3s;}
.esm-ded-add{border:1px dashed #22d3ee;background:#ecfeff;color:#0891b2;border-radius:8px;font-size:11.5px;font-weight:700;padding:3px 12px;cursor:pointer;}
.esm-ded-add:hover{background:#cffafe;}
/* Proof docs */
.esm-docs{display:flex;flex-wrap:wrap;gap:8px;}
.esm-doc{display:inline-flex;align-items:center;gap:7px;max-width:100%;padding:8px 12px;border:1.5px solid #dbe7ec;border-radius:10px;background:#f8fafc;color:#0c4a6e;text-decoration:none;font-size:12.5px;font-weight:600;}
.esm-doc:hover{border-color:#0891b2;background:#e0f2fe;}
.esm-doc-name{max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.esm-doc-ext{opacity:.55;font-size:12px;}
[data-bs-theme="dark"] .esm-doc{background:#0b2029;border-color:#173947;color:#cffafe;}
/* Deduction rows — show ~3, scroll the rest */
.esm-ded-list{display:flex;flex-direction:column;gap:8px;max-height:150px;overflow-y:auto;padding-right:4px;margin-right:-4px;}
.esm-ded-list::-webkit-scrollbar{width:7px;}
.esm-ded-list::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:7px;}
[data-bs-theme="dark"] .esm-ded-list::-webkit-scrollbar-thumb{background:#334155;}
.esm-ded{display:grid;grid-template-columns:4fr 7fr 1fr;gap:8px;align-items:center;}
.esm-ded-amt{display:flex;align-items:center;position:relative;min-width:0;}
.esm-ded-amt .esm-cur{position:absolute;left:11px;color:#64748b;font-size:13px;pointer-events:none;}
.esm-ded-amt .esm-in{padding-left:22px;padding-right:6px;}
.esm-ded-reason{min-width:0;}
.esm-ded-x{width:100%;height:34px;border:1.5px solid #fecdd3;border-radius:9px;background:#fff1f2;color:#e11d48;font-size:12px;cursor:pointer;}
.esm-ded-x:hover{background:#ffe4e6;}
/* 70 / 30 split — deductions on the left, claimed/summary on the right */
.esm-split{display:flex;gap:16px;margin-top:16px;align-items:stretch;}
.esm-split-l{flex:7;margin-top:0;min-width:0;}
.esm-split-r{flex:3;margin-top:0;min-width:0;display:flex;flex-direction:column;}
.esm-split-r .esm-sumrow.is-grand{margin-top:auto;}
@media (max-width:720px){.esm-split{flex-direction:column;}.esm-split-l,.esm-split-r{flex:1 1 auto;width:100%;}}
/* Summary box */
.esm-sumbox{margin-top:16px;border:1.5px solid #cffafe;border-radius:12px;overflow:hidden;}
[data-bs-theme="dark"] .esm-sumbox{border-color:#173947;}
.esm-sumrow{display:flex;justify-content:space-between;gap:10px;padding:9px 14px;font-size:12.5px;font-weight:600;color:#334155;background:#f8feff;}
.esm-sumrow>span:first-child{flex-shrink:0;}
.esm-sumrow>span:last-child{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right;}
.esm-sumrow+.esm-sumrow{border-top:1px solid #e2eef2;}
[data-bs-theme="dark"] .esm-sumrow{background:#0d2730;color:#cbd5e1;}
.esm-sumrow.is-grand{background:linear-gradient(120deg,#0891b2,#06b6d4);color:#fff;font-weight:800;font-size:13.5px;}
.esm-sumrow.is-grand.is-bad{background:linear-gradient(120deg,#e11d48,#f43f5e);}
.esm-payrow{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;font-size:12px;padding:6px 0;border-bottom:1px dashed #e2e8f0;}
/* Adjustment reason — clamp to 3 lines; the untruncated text lives in the
   row's title tooltip. min-width:0 lets the flex child shrink so the clamp
   engages instead of pushing the amount off the row. */
.esm-adj-reason{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;min-width:0;flex:1;line-height:1.35;word-break:break-word;}
.esm-payrow .is-pos,.esm-payrow .is-neg{flex-shrink:0;white-space:nowrap;}
/* Payment history table */
/* History table — exact styling from the PO "Payment Summary" table (pop-tbl). */
/* Cap every table at ~4 rows — the rest scrolls vertically with a sticky header. */
.esm-tblwrap{overflow-x:auto;overflow-y:auto;max-height:224px;border-radius:12px;border:1px solid #dbeef4;box-shadow:0 2px 8px rgba(15,23,42,.05);}
[data-bs-theme="dark"] .esm-tblwrap{border-color:#173947;box-shadow:none;}
.esm-tbl{width:100%;border-collapse:collapse;font-size:12px;background:transparent;}
.esm-tbl thead tr{background:linear-gradient(90deg,#0e7490 0%,#0891b2 45%,#22d3ee 100%);}
.esm-tbl thead th{text-align:left;vertical-align:middle;background:#0e8aa6;color:#fff;font-size:9.5px;font-weight:700;letter-spacing:.04em;line-height:1.25;padding:11px 12px;white-space:nowrap;position:sticky;top:0;z-index:1;}
[data-bs-theme="dark"] .esm-tbl thead th{background:#0b6f85;}
[data-bs-theme="dark"] .esm-tbl thead tr{background:linear-gradient(90deg,#0e5566,#0b6f85 55%,#0e7f97);}
.esm-tbl tbody tr,.esm-tbl tbody td{background:#fff;}
.esm-tbl tbody td{padding:11px 12px;border-bottom:1px solid #eef2f7;color:#334155;font-weight:500;white-space:nowrap;vertical-align:middle;}
[data-bs-theme="dark"] .esm-tbl tbody tr,[data-bs-theme="dark"] .esm-tbl tbody td{background:#0c232c;border-color:#132e39;color:#cbd5e1;}
.esm-tbl tbody tr:hover td{background:#f6fdff;}
[data-bs-theme="dark"] .esm-tbl tbody tr:hover td{background:#0e2a34;}
.esm-tbl-amt{font-weight:800;color:#0f172a;}
/* Zoho Books status pill + sync button */
.esm-zpill{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:700;padding:3px 10px;border-radius:999px;white-space:nowrap;}
.esm-zpill.is-synced{background:#d6f4e3;color:#108548;}
.esm-zpill.is-unsynced{background:#fde8c4;color:#a4661c;}
[data-bs-theme="dark"] .esm-zpill.is-synced{background:#0c2e1d;color:#4ade80;}
[data-bs-theme="dark"] .esm-zpill.is-unsynced{background:#3a2a08;color:#fbbf24;}
.esm-zbtn{display:inline-flex;align-items:center;gap:6px;border:1.5px solid #0891b2;background:#fff;color:#0e7490;border-radius:8px;padding:5px 11px;font-size:11.5px;font-weight:700;cursor:pointer;white-space:nowrap;transition:background .15s;}
.esm-zbtn:hover:not(:disabled){background:#ecfeff;}
.esm-zbtn:disabled{opacity:.55;cursor:not-allowed;}
[data-bs-theme="dark"] .esm-zbtn{background:#0b2029;border-color:#0891b2;color:#67e8f9;}
.esm-zbtn--view{border-color:#86efac;color:#108548;text-decoration:none;}
.esm-zbtn--view:hover{background:#ecfdf5;}
[data-bs-theme="dark"] .esm-zbtn--view{background:#0b2029;border-color:#10b981;color:#4ade80;}
[data-bs-theme="dark"] .esm-tbl-amt{color:#e2e8f0;}
.esm-tbl-link{display:inline-flex;align-items:center;gap:5px;max-width:170px;overflow:hidden;text-overflow:ellipsis;color:#0891b2;text-decoration:none;font-weight:600;}
.esm-tbl-link:hover{text-decoration:underline;}
.esm-foot{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px 28px 22px;border-top:1px solid #eef2f4;background:#f8fafc;flex-shrink:0;}
[data-bs-theme="dark"] .esm-foot{background:#0b1a22;border-color:#173947;}
.esm-foot-hint{display:flex;align-items:center;gap:7px;font-size:12px;color:#64748b;min-width:0;}
.esm-foot-hint i{color:#0891b2;font-size:15px;flex-shrink:0;}
.esm-foot-r{display:flex;gap:10px;flex-shrink:0;}
.esm-btn-ghost{border:1.5px solid #d5dfe4;background:#fff;color:#475569;border-radius:10px;padding:9px 18px;font-size:13px;font-weight:700;cursor:pointer;}
.esm-btn-ghost:hover{background:#f1f5f9;}
[data-bs-theme="dark"] .esm-btn-ghost{background:#0b2029;border-color:#173947;color:#cbd5e1;}
.esm-btn-primary{border:none;border-radius:10px;padding:9px 22px;font-size:13px;font-weight:800;cursor:pointer;color:#fff;background:linear-gradient(120deg,#0891b2,#06b6d4);box-shadow:0 4px 12px rgba(8,145,178,.28);}
.esm-btn-primary:hover{filter:brightness(1.05);}
.esm-btn-primary:disabled{opacity:.55;cursor:not-allowed;box-shadow:none;}
/* Review footer — approve / reject */
.esm-btn-approve{border:none;border-radius:10px;padding:9px 24px;font-size:13px;font-weight:800;cursor:pointer;color:#fff;background:linear-gradient(135deg,#0ab39c,#059669);box-shadow:0 4px 12px rgba(5,150,105,.3);}
.esm-btn-approve:hover:not(:disabled){filter:brightness(1.05);}
.esm-btn-approve:disabled{opacity:.55;cursor:not-allowed;box-shadow:none;}
.esm-btn-reject{border:none;border-radius:10px;padding:9px 22px;font-size:13px;font-weight:800;cursor:pointer;color:#fff;background:linear-gradient(135deg,#f06548,#e11d48);box-shadow:0 4px 12px rgba(225,29,72,.28);}
.esm-btn-reject:hover:not(:disabled){filter:brightness(1.05);}
.esm-btn-reject:disabled{opacity:.55;cursor:not-allowed;box-shadow:none;}
.esm-reject-in{flex:1;min-width:0;}
/* Approve / Reject confirmation dialog */
.esm-confirm{width:100%;max-width:440px;background:#fff;border-radius:16px;padding:24px;display:flex;flex-direction:column;align-items:center;text-align:center;gap:12px;box-shadow:0 30px 80px rgba(15,23,42,.5);}
[data-bs-theme="dark"] .esm-confirm{background:#0f172a;color:#e2e8f0;}
.esm-confirm-ico{width:52px;height:52px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:28px;color:#fff;}
.esm-confirm-ico.is-approve{background:linear-gradient(135deg,#0ab39c,#059669);box-shadow:0 8px 20px rgba(5,150,105,.35);}
.esm-confirm-ico.is-reject{background:linear-gradient(135deg,#f06548,#e11d48);box-shadow:0 8px 20px rgba(225,29,72,.32);}
.esm-confirm-title{font-size:17px;font-weight:800;color:#0f172a;}
[data-bs-theme="dark"] .esm-confirm-title{color:#e2e8f0;}
.esm-confirm-msg{font-size:13px;color:#475569;line-height:1.5;}
[data-bs-theme="dark"] .esm-confirm-msg{color:#94a3b8;}
.esm-confirm .esm-in{text-align:left;}
.esm-confirm-actions{display:flex;gap:10px;justify-content:center;margin-top:4px;}
.esm-confirm--wide{max-width:480px;align-items:stretch;text-align:left;}
.esm-confirm--wide .esm-confirm-ico{align-self:center;}
.esm-confirm--wide .esm-confirm-title{text-align:center;}
.esm-confirm-sub{font-size:13px;color:#475569;line-height:1.5;text-align:center;}
[data-bs-theme="dark"] .esm-confirm-sub{color:#94a3b8;}
.esm-choose-fld{display:flex;flex-direction:column;gap:6px;}
.esm-choose-fld>label{font-size:11px;font-weight:800;letter-spacing:.04em;color:#64748b;}
[data-bs-theme="dark"] .esm-choose-fld>label{color:#94a3b8;}
.esm-choose-note{display:flex;gap:8px;align-items:flex-start;background:#fff7ed;border:1px solid #fed7aa;color:#9a3412;border-radius:10px;padding:10px 12px;font-size:12.5px;line-height:1.5;}
.esm-choose-note i{font-size:16px;flex:0 0 auto;margin-top:1px;}
[data-bs-theme="dark"] .esm-choose-note{background:rgba(154,52,18,.18);border-color:rgba(154,52,18,.5);color:#fdba74;}
/* Settle Advance — start card + locked-type chip */
.esm-settle-start{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;background:#f0fbff;border:1px dashed #7dd3e8;border-radius:12px;padding:16px 18px;}
[data-bs-theme="dark"] .esm-settle-start{background:rgba(14,116,144,.14);border-color:rgba(14,116,144,.5);}
.esm-settle-start-h{font-size:14px;font-weight:800;color:#0f172a;}
[data-bs-theme="dark"] .esm-settle-start-h{color:#e2e8f0;}
.esm-settle-start-p{font-size:12.5px;color:#475569;line-height:1.5;margin-top:2px;max-width:520px;}
[data-bs-theme="dark"] .esm-settle-start-p{color:#94a3b8;}
.esm-settle-lock{display:inline-flex;align-items:center;gap:8px;background:#eef2ff;border:1px solid #c7d2fe;color:#3730a3;border-radius:999px;padding:6px 14px;font-size:12.5px;font-weight:600;margin-bottom:12px;}
.esm-settle-lock i{font-size:15px;}
[data-bs-theme="dark"] .esm-settle-lock{background:rgba(99,102,241,.18);border-color:rgba(99,102,241,.5);color:#c7d2fe;}
/* Settle Advance popup — header strip with 3 stats */
.esm-settle-strip{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;background:#f0fbff;border:1px solid #cdeef6;border-radius:12px;padding:12px 14px;}
[data-bs-theme="dark"] .esm-settle-strip{background:rgba(14,116,144,.12);border-color:rgba(14,116,144,.4);}
.esm-settle-stat{display:flex;align-items:center;gap:10px;min-width:0;}
.esm-settle-stat+.esm-settle-stat{border-left:1px solid #cdeef6;padding-left:12px;}
[data-bs-theme="dark"] .esm-settle-stat+.esm-settle-stat{border-left-color:rgba(14,116,144,.4);}
.esm-settle-stat-ic{width:38px;height:38px;flex:0 0 auto;border-radius:9px;display:inline-flex;align-items:center;justify-content:center;font-size:18px;color:#fff;background:linear-gradient(135deg,#f59e0b,#f97316);}
.esm-settle-stat-ic.is-type{background:linear-gradient(135deg,#6366f1,#4f46e5);}
.esm-settle-stat-ic.is-goal{background:linear-gradient(135deg,#0891b2,#06b6d4);}
.esm-settle-stat-lab{font-size:10px;font-weight:800;letter-spacing:.05em;color:#64748b;}
[data-bs-theme="dark"] .esm-settle-stat-lab{color:#94a3b8;}
.esm-settle-stat-val{font-size:16px;font-weight:800;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.esm-settle-stat-val--sm{font-size:12.5px;font-weight:700;white-space:normal;line-height:1.25;}
[data-bs-theme="dark"] .esm-settle-stat-val{color:#e2e8f0;}
@media (max-width:640px){.esm-settle-strip{grid-template-columns:1fr;}.esm-settle-stat+.esm-settle-stat{border-left:none;padding-left:0;border-top:1px solid #cdeef6;padding-top:10px;}}
/* Settle Advance popup — itemised usage rows */
.esm-settle-rows{display:flex;flex-direction:column;gap:8px;}
/* Scroll the row list after ~4 rows so the popup height stays fixed. */
.esm-srow-scroll{display:flex;flex-direction:column;gap:8px;max-height:212px;overflow-y:auto;overflow-x:hidden;padding-right:4px;}
.esm-srow{display:grid;grid-template-columns:minmax(110px,2.2fr) minmax(0,4fr) minmax(120px,1.7fr) 150px 40px;gap:10px;align-items:center;}
.esm-srow-method{min-width:0;}
.esm-srow-add{align-self:flex-end;width:auto;padding:7px 18px;font-size:12px;}
.esm-payout-amt{font-size:18px;font-weight:800;}
.esm-payout-row{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;}
.esm-payout-note{font-size:12.5px;color:#475569;line-height:1.5;flex:1;min-width:200px;}
[data-bs-theme="dark"] .esm-payout-note{color:#94a3b8;}
.esm-payout-btn{white-space:nowrap;padding:10px 18px;}
.esm-return-modes{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
.esm-return-mode{display:flex;align-items:center;gap:10px;text-align:left;border:1.5px solid #e2e8f0;background:#fff;border-radius:10px;padding:12px;cursor:pointer;}
.esm-return-mode i{font-size:22px;color:#0891b2;flex:0 0 auto;}
.esm-return-mode.is-on{border-color:#0891b2;background:#f0fbff;box-shadow:0 0 0 2px rgba(8,145,178,.15);}
.esm-return-mode-t{font-size:13px;font-weight:800;color:#0f172a;}
.esm-return-mode-s{font-size:11px;color:#64748b;margin-top:1px;}
[data-bs-theme="dark"] .esm-return-mode{background:#0d1b2a;border-color:#28405a;}
[data-bs-theme="dark"] .esm-return-mode.is-on{background:rgba(8,145,178,.14);}
[data-bs-theme="dark"] .esm-return-mode-t{color:#e2e8f0;}
@media (max-width:560px){.esm-return-modes{grid-template-columns:1fr;}}
.esm-return-grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
@media (max-width:560px){.esm-return-grid2{grid-template-columns:1fr;}}
/* Return modal stepper — boxed wizard (icon badge + number badge), teal theme */
.esm-wstepper{display:flex;align-items:center;gap:0;}
.esm-wstep-connector{flex:0 0 28px;height:28px;display:flex;align-items:center;justify-content:center;flex-shrink:0;}
.esm-wconnector-line{width:100%;height:3px;background:#e2e8f0;border-radius:3px;position:relative;overflow:hidden;}
.esm-wconnector-line::after{content:'';position:absolute;inset:0;background:linear-gradient(90deg,#22c55e,#16a34a);border-radius:3px;transform:scaleX(0);transform-origin:left;transition:transform .5s cubic-bezier(.4,0,.2,1);}
.esm-wconnector-line[data-done="1"]::after{transform:scaleX(1);}
.esm-wstep{flex:1;padding:11px 14px;border-radius:14px;display:flex;align-items:center;gap:12px;position:relative;overflow:hidden;transition:all .25s;cursor:pointer;min-width:0;}
.esm-wstep-badge-wrap{position:relative;flex-shrink:0;width:40px;height:40px;}
.esm-wstep-badge{width:40px;height:40px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:19px;transition:all .25s;}
.esm-wstep-num{position:absolute;bottom:-4px;right:-4px;width:18px;height:18px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:900;border:2px solid #fff;line-height:1;box-shadow:0 1px 3px rgba(0,0,0,.15);}
.esm-wstep-text{min-width:0;flex:1;}
.esm-wstep-title{font-size:12px;font-weight:800;letter-spacing:-.2px;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.esm-wstep-sub{font-size:9.5px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
/* Active — teal */
.esm-wstep-active{background:linear-gradient(135deg,#e0f7fb 0%,#cbeef6 100%);border:2px solid #22d3ee;box-shadow:0 6px 20px rgba(8,145,178,.18),0 1px 0 rgba(255,255,255,.85) inset;}
.esm-wstep-active .esm-wstep-badge{background:linear-gradient(135deg,#0891b2,#0e7490);color:#fff;box-shadow:0 5px 14px rgba(14,116,144,.48);}
.esm-wstep-active .esm-wstep-num{background:linear-gradient(135deg,#0e7490,#155e75);color:#fff;}
.esm-wstep-active .esm-wstep-title{color:#083344;}
.esm-wstep-active .esm-wstep-sub{color:#0e7490;}
/* Done — green */
.esm-wstep-done{background:linear-gradient(135deg,#ecfdf5 0%,#d1fae5 100%);border:2px solid #34d399;box-shadow:0 6px 20px rgba(16,185,129,.18),0 1px 0 rgba(255,255,255,.85) inset;}
.esm-wstep-done .esm-wstep-badge{background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;box-shadow:0 5px 12px rgba(22,163,74,.42);}
.esm-wstep-done .esm-wstep-num{background:#fff;color:#16a34a;box-shadow:0 1px 3px rgba(22,163,74,.30);}
.esm-wstep-done .esm-wstep-title{color:#065f46;}
.esm-wstep-done .esm-wstep-sub{color:#059669;}
/* Pending — neutral */
.esm-wstep-pending{background:#f8fafc;border:1.5px solid #e2e8f0;opacity:.85;}
.esm-wstep-pending .esm-wstep-badge{background:linear-gradient(135deg,#f1f5f9,#e2e8f0);color:#94a3b8;}
.esm-wstep-pending .esm-wstep-num{background:#e2e8f0;color:#94a3b8;}
.esm-wstep-pending .esm-wstep-title{color:#94a3b8;}
.esm-wstep-pending .esm-wstep-sub{color:#cbd5e1;}
[data-bs-theme="dark"] .esm-wstep-active{background:linear-gradient(135deg,rgba(14,116,144,.42),rgba(8,145,178,.28));border-color:#22d3ee;}
[data-bs-theme="dark"] .esm-wstep-active .esm-wstep-title{color:#e0f7fb;}
[data-bs-theme="dark"] .esm-wstep-done{background:linear-gradient(135deg,rgba(6,95,70,.45),rgba(16,185,129,.20));border-color:#34d399;}
[data-bs-theme="dark"] .esm-wstep-done .esm-wstep-title{color:#d1fae5;}
[data-bs-theme="dark"] .esm-wstep-pending{background:rgba(40,52,70,.6);border-color:rgba(148,163,184,.25);}
[data-bs-theme="dark"] .esm-wstep-pending .esm-wstep-title{color:#cbd5e1;}
@media (max-width:640px){.esm-wstep-sub{display:none;}.esm-wstep-connector{flex-basis:16px;}}
/* Locked field (row 2 before step 1 done) */
.esm-fld.is-locked{opacity:.55;}
.esm-fld.is-locked .esm-in,.esm-fld.is-locked .esm-money{background:#f1f5f9;cursor:not-allowed;}
[data-bs-theme="dark"] .esm-fld.is-locked .esm-in,[data-bs-theme="dark"] .esm-fld.is-locked .esm-money{background:#0d2730;}
.esm-settle-donenote{display:flex;align-items:flex-start;gap:8px;background:#d6f4e3;border:1px solid #a7e3c2;color:#108548;border-radius:9px;padding:10px 14px;font-size:12.5px;font-weight:600;line-height:1.45;}
.esm-settle-donenote i{font-size:16px;flex:0 0 auto;margin-top:1px;}
[data-bs-theme="dark"] .esm-settle-donenote{background:rgba(16,133,72,.18);border-color:rgba(16,133,72,.5);color:#6ee7b7;}
/* Read-only settle table — give REASON the most room, never scroll sideways */
.esm-tblwrap--settle{overflow-x:hidden;}
.esm-tbl--settle{table-layout:fixed;width:100%;}
.esm-tbl--settle th:nth-child(1),.esm-tbl--settle td:nth-child(1){width:50px;}
.esm-tbl--settle th:nth-child(2),.esm-tbl--settle td:nth-child(2){width:100px;}
.esm-tbl--settle th:nth-child(3),.esm-tbl--settle td:nth-child(3){width:auto;}
.esm-tbl--settle th:nth-child(4),.esm-tbl--settle td:nth-child(4){width:120px;}
.esm-tbl--settle th:nth-child(5),.esm-tbl--settle td:nth-child(5){width:200px;padding-right:16px;}
.esm-tbl--settle td{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.esm-tbl--settle td:nth-child(3){white-space:normal;word-break:break-word;}
.esm-tbl--settle .esm-tbl-link{display:block;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.esm-tbl--settle .esm-tbl-link i{margin-right:5px;}
.esm-srow-hd{padding:0 2px 2px;}
.esm-srow-hd>span{font-size:10.5px;font-weight:800;letter-spacing:.04em;color:#64748b;}
[data-bs-theme="dark"] .esm-srow-hd>span{color:#94a3b8;}
.esm-srow .esm-in{height:41px;}
.esm-srow-file{flex:0 0 auto;width:158px;height:41px;margin:0;}
.esm-srow-x{width:40px;height:41px;display:inline-flex;align-items:center;justify-content:center;border:1.5px solid #fecdd3;border-radius:9px;background:#fff1f2;color:#e11d48;font-size:16px;cursor:pointer;}
.esm-srow-x:hover:not(:disabled){background:#ffe4e6;}
.esm-srow-x:disabled{opacity:.4;cursor:not-allowed;}
.esm-settle-sum{border:1px solid #e2eef2;border-radius:10px;overflow:hidden;align-self:start;}
[data-bs-theme="dark"] .esm-settle-sum{border-color:#1e3a44;}
.esm-settle-sum .esm-sumrow.is-grand{color:#fff;}
/* Totals + outcome action, side by side */
.esm-settle-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:4px;align-items:stretch;}
.esm-settle-action{display:flex;flex-direction:column;align-items:flex-start;gap:6px;border:1px dashed #cbd5e1;border-radius:10px;padding:16px;background:#f8fafc;}
[data-bs-theme="dark"] .esm-settle-action{background:#0d1b2a;border-color:#28405a;}
.esm-settle-action.is-ready{border-style:solid;border-color:#7dd3e8;background:#f0fbff;}
[data-bs-theme="dark"] .esm-settle-action.is-ready{background:rgba(14,116,144,.14);border-color:rgba(14,116,144,.5);}
.esm-act-lab{font-size:10.5px;font-weight:800;letter-spacing:.05em;color:#64748b;}
[data-bs-theme="dark"] .esm-act-lab{color:#94a3b8;}
.esm-act-amt{font-size:24px;font-weight:800;line-height:1.1;color:#475569;}
.esm-act-amt.is-return{color:#a4661c;}
.esm-act-amt.is-reimburse{color:#0e7490;}
.esm-act-amt.is-equal{color:#108548;}
.esm-act-amt.is-pending{color:#64748b;}
.esm-act-p{font-size:12px;color:#64748b;line-height:1.45;}
[data-bs-theme="dark"] .esm-act-p{color:#94a3b8;}
.esm-act-btn{margin-top:auto;width:100%;justify-content:center;padding:11px 16px;font-size:13.5px;}
@media (max-width:720px){.esm-settle-grid{grid-template-columns:1fr;}}
/* Locked (already-saved) settle rows */
.esm-srow--locked{opacity:.9;}
.esm-srow--locked .esm-in{background:#f1f5f9;color:#475569;cursor:default;border-color:#e2e8f0;}
[data-bs-theme="dark"] .esm-srow--locked .esm-in{background:#0d2730;color:#94a3b8;border-color:#1e3a44;}
.esm-srow--locked .esm-file-chip{background:#f1f5f9;}
.esm-srow-lockic{width:40px;height:41px;display:inline-flex;align-items:center;justify-content:center;color:#94a3b8;font-size:15px;}
.esm-btn-soft{border:1px solid #7dd3e8;background:#ecfeff;color:#0891b2;border-radius:9px;font-size:13px;font-weight:700;padding:9px 16px;cursor:pointer;}
.esm-btn-soft:hover:not(:disabled){background:#cffafe;}
.esm-btn-soft:disabled{opacity:.55;cursor:not-allowed;}
[data-bs-theme="dark"] .esm-btn-soft{background:rgba(8,145,178,.16);border-color:rgba(8,145,178,.5);color:#67e8f9;}
@media (max-width:720px){.esm-srow{grid-template-columns:1fr 1fr;}.esm-srow-hd{display:none;}.esm-srow-file{width:100%;}}
@media (max-width:640px){.esm-grid,.esm-steps{grid-template-columns:1fr;}.esm-ded-amt{flex-basis:120px;}}
`;
