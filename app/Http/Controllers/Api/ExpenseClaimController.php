<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Branch;
use App\Models\Employee;
use App\Models\ExpenseClaim;
use App\Models\Module;
use App\Models\Permission;
use App\Support\OnboardingGuard;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;


class ExpenseClaimController extends Controller
{
    private const STATUSES = ['pending', 'approved', 'rejected'];
    public function categories(Request $request)
    {
        $user = $request->user();
        $q = \App\Models\Masters\ExpenseCategories::query()
            ->where('status', 'Active')
            ->orderBy('name');

        $this->applyCategoryScope($q, $user, $request->integer('branch_id') ?: null);

        // Expense categories no longer carry monthly/yearly limits — claims and
        // advances can be raised for any amount, so we just return the active
        // category list for the dropdowns.
        $cats = $q->get(['id', 'name', 'code']);

        return response()->json($cats);
    }
    private function applyCategoryScope($q, $user, ?int $branchFilter): void
    {
        if (!$user) { $q->whereRaw('1 = 0'); return; }

        if ($user->user_type === 'super_admin') {
            if ($branchFilter !== null) $q->where('branch_id', $branchFilter);
            return;
        }

        $clientId = $user->client_id;

        if (in_array($user->user_type, ['client_admin', 'client_user'], true)) {
            $q->where(function ($w) use ($clientId) {
                $w->whereNull('client_id')->orWhere('client_id', $clientId);
            });
            $this->applySwitcherBranchFilter($q, $user, $branchFilter);
            return;
        }

        if (in_array($user->user_type, ['branch_user', 'employee'], true)) {
            $branchId = $user->branch_id;
            $q->where(function ($w) use ($clientId, $branchId) {
                $w->whereNull('client_id')
                  ->orWhere(function ($ww) use ($clientId, $branchId) {
                      $ww->where('client_id', $clientId)
                         ->where(function ($wb) use ($branchId) {
                             $wb->whereNull('branch_id')->orWhere('branch_id', $branchId);
                         });
                  });
            });
            return;
        }

        $q->whereRaw('1 = 0');
    }

    public function index(Request $request)
    {
        $user = $request->user();
        $scope = $request->query('scope', 'mine');
        if (!in_array($scope, ['mine', 'team', 'all'], true)) {
            $scope = 'mine';
        }


        $employeeIdFilter = $this->resolveEmployeeId(
            $request->query('employee_id'),
            $request->query('employee_code'),
            $user
        );

        $q = ExpenseClaim::query()
            ->with([
                // Load employee/manager WITH trashed rows so a disabled
                // (soft-deleted via the Remove action) employee's name still
                // resolves — otherwise the relation is null and the row shows
                // "#<id>" instead of the name.
                'employee' => fn ($r) => $r->withTrashed()
                    ->select('id', 'first_name', 'middle_name', 'last_name', 'display_name', 'emp_code', 'reporting_manager_id', 'reporting_manager_user_id', 'department_id'),
                'employee.department:id,name',
                // Branch-user manager (when the employee reports to a branch user).
                'employee.reportingManagerUser:id,name',
                'manager' => fn ($r) => $r->withTrashed()
                    ->select('id', 'first_name', 'middle_name', 'last_name', 'display_name', 'emp_code'),
                'category:id,name,code',
                'creator:id,name,user_type',
                'hrUser:id,name,user_type',
                'reimbursedAdvance:id,advance_no,settle_reimbursement_claim_id',
                // Who acted at the manager stage (named in the audit log).
                'managerActor:id,name',
                // Payout list for the audit log (payer name + amount + date).
                'payments' => fn ($r) => $r->with('payer:id,name'),
            ])
            ->orderByDesc('id');

        // Tenant gate (mirrors MasterController::applyScope rules).
        $this->applyTenantScope($q, $user, $request->integer('branch_id') ?: null);

        if ($scope === 'mine') {
            // "Mine" = the authenticated user's OWN claims. For a non-super-admin,
            // resolve from the auth user — NOT a request employee_id/code. The SPA
            // sends a numeric employee_id and resolveEmployeeId returns it verbatim
            // (no tenant/ownership check); a stale/wrong value would filter to
            // another employee and return an EMPTY list of the user's own claims.
            $targetEmployeeId = ($user && $user->user_type === 'super_admin')
                ? ($employeeIdFilter ?: $this->currentEmployeeId($user))
                : ($this->currentEmployeeId($user) ?: $employeeIdFilter);
            $q->where('employee_id', $targetEmployeeId ?? -1);
        } elseif ($scope === 'team') {
            // Team scope rules:
            //   - super_admin / client_admin / branch_user → no extra filter;
            //     tenant scope already restricts the rows they may see, and
            //     they should be able to view every claim inside that scope
            //     from the My Team surface.
            //   - employee / client_user acting as a manager → all rows
            //     filed by their *transitive* downstream (direct reports +
            //     reports-of-reports, recursively) so a senior manager
            //     sees the whole sub-tree, not just the first hop.
            if (in_array($user->user_type, ['super_admin', 'client_admin', 'branch_user'], true)) {
                // no-op — tenant scope is the only filter.
            } else {
                $myEmployeeId = $this->currentEmployeeId($user);
                $teamIds = $this->downstreamEmployeeIds($myEmployeeId);
                // Being a manager is what makes a "team" exist at all. Someone
                // who has never had a report gets an EMPTY team view — without
                // this gate the self-row below made Team an exact duplicate of
                // My Expenses, which reads as "these are my team's" when
                // they are the viewer's own. Past counts as managing: a report
                // reassigned elsewhere leaves rows still routed here.
                $managedOthers = $myEmployeeId && ExpenseClaim::where('manager_id', $myEmployeeId)
                    ->where('employee_id', '!=', $myEmployeeId)
                    ->exists();
                if (!$teamIds && !$managedOthers) {
                    return response()->json([]);
                }
                // Include the manager's OWN claims — the "My Team" surface shows
                // the whole team and a manager is part of their team, so their
                // own claims must appear alongside their reports' (QA #144).
                if ($myEmployeeId) $teamIds[] = $myEmployeeId;
                $teamIds = array_values(array_unique($teamIds)) ?: [-1];
                // Filtering on employee_id alone reads the hierarchy as it stands
                // TODAY: the moment a report is moved under a different manager,
                // every row they ever filed disappears from this manager's team
                // view and it collapses to just their own rows. manager_id is
                // stamped from the employee's reporting manager at filing time,
                // so OR-ing it back in keeps the rows that were actually routed
                // here — approval history stays with whoever owned the approval.
                $q->where(function ($w) use ($teamIds, $myEmployeeId) {
                    $w->whereIn('employee_id', $teamIds);
                    if ($myEmployeeId) {
                        $w->orWhere('manager_id', $myEmployeeId);
                    }
                });
            }
        } else {
            // scope=all — for HR/admin views. No additional filter beyond
            // tenant scope. Frontend gates the menu by permission.
            $this->guardHrPermission($user, 'can_view');
            if ($employeeIdFilter) {
                $q->where('employee_id', $employeeIdFilter);
            }
        }

        if ($status = $request->query('status')) {
            if (in_array($status, self::STATUSES, true)) {
                $q->where('status', $status);
            }
        }

        return response()->json($q->get()->map(fn ($r) => $this->serialize($r)));
    }

    /* ============================================================ */
    /*  STORE                                                       */
    /* ============================================================ */

    public function store(Request $request)
    {
        $user = $request->user();
        // A non-super-admin can ONLY file for their own Employee record (the
        // ownership guard below enforces it). So derive the target straight from
        // the authenticated user — do NOT trust a request-supplied employee_id /
        // employee_code. The SPA posts a numeric employee_id, and resolveEmployeeId
        // returns any numeric id verbatim (no tenant/ownership check); a stale or
        // wrong value there resolves to someone else's row and trips the guard
        // with a confusing "not your record" 403 even for a legitimate self-file.
        // Super-admins may legitimately target any employee via the request.
        if ($user && $user->user_type === 'super_admin') {
            $employeeId = $this->resolveEmployeeId(
                $request->input('employee_id'),
                $request->input('employee_code'),
                $user
            ) ?: $this->currentEmployeeId($user);
        } else {
            $employeeId = $this->currentEmployeeId($user)
                ?: $this->resolveEmployeeId(
                    $request->input('employee_id'),
                    $request->input('employee_code'),
                    $user
                );
        }

        if (!$employeeId) {
            abort(422, 'No linked Employee record found for the current user.');
        }
        $employee = Employee::find($employeeId);
        if (!$employee) {
            abort(404, 'Employee not found.');
        }
        // Anyone but super_admin can only file under their own Employee record.
        if ($user->user_type !== 'super_admin'
            && $employee->user_id !== $user->id) {
            abort(403, 'You can only file claims for your own employee record.');
        }

        // Onboarding gate (CBC #85) — no claims until HR has finished onboarding
        // the employee. Reachable before this because /profile stays open to a
        // mid-onboarding employee and carries the claim form.
        OnboardingGuard::assertComplete(
            $employee,
            'raise an expense claim',
            (int) ($employee->user_id ?? 0) === (int) $user->id,
        );

        // A future-joining employee is not yet on the roster — they cannot raise
        // an expense claim before their joining date (CBC #32).
        if ($employee->date_of_joining
            && $employee->date_of_joining->toDateString() > now()->toDateString()) {
            return response()->json([
                'message' => 'You cannot raise an expense claim before your joining date ('
                    . $employee->date_of_joining->format('d M Y') . ').',
                'errors'  => ['employee_id' => ['Joining date is in the future.']],
            ], 422);
        }

        // Expense date window — today back to 30 days ago. Mirrors the
        // client-side bound so a direct API call can't backdate a claim
        // beyond policy or file a future-dated expense.
        $minExpenseDate = now()->subDays(30)->toDateString();

        // The browser normalises <textarea> newlines to CRLF when serialising
        // multipart/form-data, so a purpose the employee typed within the 500
        // on-screen limit arrives with an extra character per line and can trip
        // max:500 (QA #89). Fold CRLF back to LF so the count matches the UI.
        if ($request->has('purpose')) {
            $request->merge(['purpose' => str_replace("\r\n", "\n", (string) $request->input('purpose'))]);
        }

        $data = $request->validate([
            'category_id'    => ['nullable', 'integer'],
            'currency'       => ['nullable', 'string', 'max:8'],
            'project'        => ['nullable', 'string', 'max:64'],
            // Payment method is mandatory — finance reconciles the payout
            // against how the employee actually paid. Enforced server-side too
            // so a direct API call can't file a claim without it.
            'payment_method' => ['required', 'string', 'max:64'],
            'title'          => ['required', 'string', 'max:255'],
            // Cap at 9,999,999,999,999.99 — well inside the decimal(18,2)
            // column on `expense_claims.amount` so a paste of "9999..."
            // is rejected by the validator with a clean 422 instead of
            // overflowing the database and surfacing as a 500.
            'amount'         => ['required', 'numeric', 'min:0', 'max:9999999999999.99'],
            'expense_date'   => ['required', 'date', 'before_or_equal:today', 'after_or_equal:' . $minExpenseDate],
            'vendor'         => ['nullable', 'string', 'max:255'],
            // Capped at 500 — an unbounded purpose wrecked the approval screen's
            // layout when rendered in full (CBC #57). Matches the advance Reason.
            'purpose'        => ['nullable', 'string', 'max:500'],
            // Proof & receipt is mandatory — every claim must be backed by at
            // least one supporting document. Enforced server-side too so the
            // requirement can't be bypassed by a direct API call.
            'files'          => ['required', 'array', 'min:1'],
            // Per-file cap 2 MB (2048 KB). The frontend enforces the same
            // limit; this mirrors it so a direct API call can't bypass it.
            'files.*'        => ['file', 'max:2048', 'mimes:pdf,jpg,jpeg,png'],
            // Optional: this claim is the reimbursement for an over-spent company
            // advance. When set (and valid), the created claim is linked back to
            // the advance and the amount is capped at the reimburse balance.
            'reimbursement_for_advance_id' => ['nullable', 'integer'],
        ], [
            'files.required'             => 'At least one proof / receipt is required.',
            'files.min'                  => 'At least one proof / receipt is required.',
            'files.*.max'                => 'Each receipt must be 2 MB or smaller.',
            'files.*.mimes'              => 'Receipts must be PDF, JPG or PNG.',
            'expense_date.before_or_equal' => 'Expense date cannot be in the future.',
            'expense_date.after_or_equal'  => 'Expense date must be within the last 30 days.',
            'title.max'                  => 'Expense title is too long — please keep it under 255 characters.',
            'purpose.max'                => 'Business purpose is too long — please keep it under 500 characters.',
        ]);

        // Total-size guard — the whole claim's receipts must stay under 5 MB
        // so a single claim's multipart POST can't exceed PHP's post_max_size
        // ("Post data too long"). Per-file size is already validated above.
        $totalBytes = collect((array) $request->file('files', []))
            ->filter()
            ->sum(fn ($f) => (int) $f->getSize());
        if ($totalBytes > 5 * 1024 * 1024) {
            throw \Illuminate\Validation\ValidationException::withMessages([
                'files' => ['Attachments total ' . round($totalBytes / 1048576, 1) . ' MB — keep the claim under 5 MB.'],
            ]);
        }

        // File attachments — accepted as multipart `files[]`. Each file is
        // stored on the public disk; the saved row carries an array of
        // {name, size, path, url} entries so the frontend can list them.
        // Files are stored with name/size/path only — the public URL is
        // built per-request at serialize() time so it always points at the
        // Laravel route (which streams the file with query-token auth).
        $attachments = [];
        if ($request->hasFile('files')) {
            $files = $request->file('files');
            $files = is_array($files) ? $files : [$files];
            foreach ($files as $f) {
                if (!$f) continue;
                $name = $f->getClientOriginalName();
                $size = $f->getSize();
                $path = $f->store('expense_claims/' . $employeeId, 'public');
                $attachments[] = [
                    'name' => $name,
                    'size' => $size,
                    'path' => $path,
                ];
            }
        }

        $categoryName = null;
        if (!empty($data['category_id'])) {
            $cat = \App\Models\Masters\ExpenseCategories::find($data['category_id']);
            $categoryName = $cat?->name;
            // Expense categories no longer carry monthly/yearly spending caps —
            // a claim of any amount is accepted (parity with advance requests).
        }

        // Reimbursement linkage — this claim closes an over-spent company
        // advance. Validate the advance and cap the amount at its balance.
        $reimbAdvance = null;
        if (!empty($data['reimbursement_for_advance_id'])) {
            $reimbAdvance = \App\Models\AdvanceRequest::find($data['reimbursement_for_advance_id']);
            $valid = $reimbAdvance
                && $reimbAdvance->employee_id === $employee->id
                && $reimbAdvance->employee_settled_at
                && $reimbAdvance->settle_type === 'reimburse'
                && !$reimbAdvance->settle_reimbursement_claim_id;
            if (!$valid) {
                $reimbAdvance = null;   // ignore invalid linkage, create a normal claim
            } else {
                $bal = round((float) $reimbAdvance->settle_balance, 2);
                if ((float) $data['amount'] > $bal + 0.005) {
                    return response()->json([
                        'message' => 'Reimbursement amount cannot exceed the balance ₹' . number_format($bal, 2) . '.',
                        'errors'  => ['amount' => ['Cannot exceed ₹' . number_format($bal, 2) . '.']],
                    ], 422);
                }
            }
        }

        // Manager stage always starts PENDING. When no EMPLOYEE reporting
        // manager is assigned, the BRANCH ADMIN is the de-facto reporting
        // manager and approves it explicitly in the Inbox (two-step audit
        // trail) instead of a silent auto-approval. Unassigned manager-stage
        // rows are routed to branch admins in MyTeamController::approvals.
        $managerStatus   = 'pending';
        $managerActedAt  = null;
        $managerComment  = null;

        // Wrap claim_no allocation + insert in a single transaction so the
        // lockForUpdate inside nextClaimNo() actually holds: two concurrent
        // submitters in the same tenant must not race to compute the same
        // EXP-#### sequence (would silently produce duplicate claim_no
        // values, breaking the audit trail and any later "find by claim_no"
        // lookup).
        $row = DB::transaction(function () use ($employee, $data, $attachments, $categoryName, $managerStatus, $managerActedAt, $managerComment, $user) {
            return ExpenseClaim::create([
                'client_id'        => $employee->client_id,
                'branch_id'        => $employee->branch_id,
                'claim_no'         => $this->nextClaimNo($employee->client_id, $employee->branch_id),
                'employee_id'      => $employee->id,
                // Snapshot the name so the claim still shows it if the
                // employee is later deleted (soft or hard).
                'employee_name'    => $employee->display_name
                    ?: trim(($employee->first_name ?? '') . ' ' . ($employee->last_name ?? '')) ?: null,
                'manager_id'       => $employee->reporting_manager_id,
                'category_id'      => $data['category_id'] ?? null,
                'category_name'    => $categoryName,
                'currency'         => $data['currency'] ?? 'INR',
                'project'          => $data['project'] ?? null,
                'payment_method'   => $data['payment_method'] ?? null,
                'title'            => $data['title'],
                'amount'           => $data['amount'],
                'expense_date'     => $data['expense_date'],
                'vendor'           => $data['vendor'] ?? null,
                'purpose'          => $data['purpose'] ?? null,
                'attachments'      => $attachments ?: null,
                'status'           => 'pending',
                'manager_status'   => $managerStatus,
                'manager_acted_at' => $managerActedAt,
                'manager_comment'  => $managerComment,
                'hr_status'        => 'pending',
                'created_by'       => $user->id,
            ]);
        });

        // Link the created claim back to the advance it reimburses.
        if ($reimbAdvance && !$reimbAdvance->settle_reimbursement_claim_id) {
            $reimbAdvance->settle_reimbursement_claim_id = $row->id;
            $reimbAdvance->settle_reimbursed_at = now();
            $reimbAdvance->save();
        }

        $row->load(['employee.department', 'manager', 'category', 'creator', 'hrUser', 'reimbursedAdvance:id,advance_no,settle_reimbursement_claim_id']);
        return response()->json($this->serialize($row), 201);
    }

    /* ============================================================ */
    /*  SHOW                                                        */
    /* ============================================================ */

    public function show(Request $request, $id)
    {
        $user = $request->user();
        $row = ExpenseClaim::with([
                // withTrashed so a disabled employee's name still resolves (see index()).
                'employee' => fn ($r) => $r->withTrashed(),
                'manager' => fn ($r) => $r->withTrashed(),
                'category', 'creator', 'hrUser',
            ])
            ->findOrFail($id);
        $this->ensureTenantAccess($row, $user);
        return response()->json($this->serialize($row));
    }

    /**
     * Stream one attachment for the given claim by its index in the
     * attachments array. Auth via query token (?token=<sanctum>) so plain
     * <a target="_blank"> clicks work — same pattern as CandidateController::downloadCv,
     * which sidesteps the storage symlink + Apache DocumentRoot mismatch
     * that causes /storage/... to 404 in some local setups.
     */
    public function downloadAttachment(Request $request, $id, $index)
    {
        $this->authenticateFromQueryToken($request);

        $row = ExpenseClaim::findOrFail($id);
        $this->ensureTenantAccess($row, $request->user());

        $idx = (int) $index;
        $atts = $row->attachments ?? [];
        if (!isset($atts[$idx]) || empty($atts[$idx]['path'])) {
            abort(404, 'Attachment not found.');
        }
        $path = $atts[$idx]['path'];
        $disk = \Illuminate\Support\Facades\Storage::disk('public');
        if (!$disk->exists($path)) {
            abort(404, 'Attachment file is missing on the server.');
        }
        $filename = $atts[$idx]['name'] ?? basename($path);
        return $disk->response($path, $filename);
    }

    /**
     * Stream the proof-of-payment file attached to one settlement installment.
     * Auth via query token (?token=<sanctum>) so plain link-clicks work.
     */
    public function downloadPaymentProof(Request $request, $paymentId)
    {
        $this->authenticateFromQueryToken($request);

        $payment = \App\Models\ExpenseClaimPayment::findOrFail($paymentId);
        $claim   = ExpenseClaim::findOrFail($payment->expense_claim_id);
        $this->ensureTenantAccess($claim, $request->user());

        if (empty($payment->proof_path)) {
            abort(404, 'No proof of payment was attached to this settlement.');
        }
        $disk = \Illuminate\Support\Facades\Storage::disk('public');
        if (!$disk->exists($payment->proof_path)) {
            abort(404, 'Proof file is missing on the server.');
        }
        return $disk->response($payment->proof_path, $payment->proof_name ?: basename($payment->proof_path));
    }

    /** Build the Zoho Books web-app deep link for an expense (region derived from
     *  the configured API host, e.g. zohoapis.in → books.zoho.in). */
    private function zohoExpenseUrl(string $expenseId): string
    {
        $cfg    = config('services.zoho_books');
        $org    = (string) ($cfg['organization_id'] ?? '');
        $region = 'in';
        if (preg_match('#zohoapis\.([a-z.]+)#i', (string) ($cfg['base_url'] ?? ''), $m)) {
            $region = $m[1];
        }
        return "https://books.zoho.{$region}/app/{$org}#/expenses/" . rawurlencode($expenseId);
    }

    /**
     * POST /expense-claims/payments/{paymentId}/sync-zoho
     * Push a settlement payment to Zoho Books as an Expense:
     *   • Expense Account   ← the payment's Expense Category (find-or-create in Zoho)
     *   • Paid Through      ← the payment method            (find-or-create in Zoho)
     *   • Amount / Notes    ← payment amount / note
     *   • Invoice # / Title ← "EXP-ID - Title"
     *   • Receipt           ← the proof-of-payment file
     * Idempotent: a payment already carrying a zoho_expense_id is not re-created.
     */
    public function syncPaymentToZoho(Request $request, $paymentId)
    {
        $user    = $request->user();
        $payment = \App\Models\ExpenseClaimPayment::findOrFail($paymentId);
        $claim   = ExpenseClaim::findOrFail($payment->expense_claim_id);
        $this->ensureTenantAccess($claim, $user);
        $this->guardHrPermission($user, 'can_approve');

        if (($payment->zoho_status ?? 'not_synced') === 'synced' || !empty($payment->zoho_expense_id)) {
            return response()->json(['status' => true, 'message' => 'This payment is already synced to Zoho Books.']);
        }

        /** @var \App\Services\ZohoBooksService $zoho */
        $zoho = app(\App\Services\ZohoBooksService::class);
        if (!$zoho->isConfigured()) {
            return response()->json(['status' => false, 'message' => 'Zoho Books is not configured on the server.'], 503);
        }

        $title    = ($claim->claim_no ?: ('EXP-' . $claim->id)) . ' - ' . ($claim->title ?: 'Expense');
        // Resolve the category LIVE from its id (payment first, then claim) so a
        // rename in the Expense Category master flows through — never the stored
        // *_name snapshot, which would go stale.
        $category = $payment->category?->name
            ?: $claim->category?->name
            ?: 'Employee Reimbursement';

        $expenseId = null;
        try {
            $payload = [
                'account_id'             => $zoho->resolveExpenseAccountId($category),
                'paid_through_account_id'=> $zoho->findOrCreatePaidThroughAccountId($payment->payment_type ?: 'Bank'),
                'date'                   => optional($payment->paid_at)->format('Y-m-d') ?: now()->format('Y-m-d'),
                'amount'                 => (float) $payment->amount,
                'reference_number'       => $title,
                'description'            => (string) ($payment->note ?? ''),
                // Our Goods/Service radio → Zoho's Expense Type (goods | service).
                'product_type'           => strtolower($payment->expense_type ?: 'goods') === 'service' ? 'service' : 'goods',
            ];
            // GST-registered orgs need source/destination of supply on the expense.
            $state = $zoho->orgStateCode();
            if ($state) {
                $payload['source_of_supply']      = $state;
                $payload['destination_of_supply'] = $state;
            }

            $expense   = $zoho->createExpense($payload);
            $expenseId = (string) ($expense['expense_id'] ?? '');

            // Attach receipts (best-effort; a receipt failure shouldn't undo an
            // otherwise-created expense). Every supporting file is pushed to the
            // Zoho expense: the settlement's proof-of-payment first, then the
            // claim's original receipt attachments — so a claim with multiple
            // receipts carries them all across, not just one.
            //
            // Zoho caps an expense at 5 receipts (10 MB each), so we stop at 5.
            // NOTE: the /receipt endpoint's accumulate-vs-replace behaviour on
            // Zoho Books is undocumented — the UI supports up to 5 receipts, so
            // we upload each separately; if a given org replaces instead of
            // accumulating, only the last would survive (logged, non-fatal).
            if ($expenseId !== '') {
                $disk = \Illuminate\Support\Facades\Storage::disk('public');

                $receiptFiles = [];
                // Proof-of-payment first — it's the strongest evidence for this expense.
                if (!empty($payment->proof_path)) {
                    $receiptFiles[] = [
                        'path' => $payment->proof_path,
                        'name' => $payment->proof_name ?: basename($payment->proof_path),
                    ];
                }
                // Then the claim's original supporting receipts (may be several).
                foreach (($claim->attachments ?? []) as $att) {
                    $p = is_array($att) ? ($att['path'] ?? null) : null;
                    if (empty($p)) continue;
                    $receiptFiles[] = [
                        'path' => $p,
                        'name' => (is_array($att) ? ($att['name'] ?? null) : null) ?: basename($p),
                    ];
                }
                // De-dup by stored path and respect Zoho's 5-receipt-per-expense cap.
                $seen = [];
                $receiptFiles = array_values(array_filter($receiptFiles, function ($f) use (&$seen) {
                    if (isset($seen[$f['path']])) return false;
                    $seen[$f['path']] = true;
                    return true;
                }));

                foreach (array_slice($receiptFiles, 0, 5) as $rf) {
                    if (!$disk->exists($rf['path'])) continue;
                    try {
                        $zoho->attachExpenseReceipt($expenseId, $disk->get($rf['path']), $rf['name']);
                    } catch (\Throwable $e) {
                        \Illuminate\Support\Facades\Log::warning('Zoho expense receipt attach failed', [
                            'payment' => $payment->id,
                            'file'    => $rf['path'],
                            'error'   => $e->getMessage(),
                        ]);
                    }
                }
            }
        } catch (\Throwable $e) {
            // Reverse a partially-created expense so a retry starts clean.
            if ($expenseId) { try { $zoho->deleteExpense($expenseId); } catch (\Throwable $ignore) {} }
            return response()->json(['status' => false, 'message' => 'Zoho Books sync failed: ' . $e->getMessage()], 422);
        }

        $payment->zoho_status    = 'synced';
        $payment->zoho_synced_at = now();
        $payment->zoho_expense_id = $expenseId;
        $payment->save();

        return response()->json([
            'status'  => true,
            'message' => 'Expense synced to Zoho Books.',
        ]);
    }

    /* ==================== Consolidated (batch) payment ==================== */

    private function expNo(ExpenseClaim $c): string
    {
        return $c->claim_no ?: ('EXP-' . str_pad((string) $c->id, 4, '0', STR_PAD_LEFT));
    }

    /**
     * GET /expense-claims/batch-payable?employee_id=
     * An employee's APPROVED, not-yet-paid claims — the pool a batch payment can
     * settle. (Only approved + unpaid; you never pay an unapproved claim.)
     */
    public function batchPayable(Request $request)
    {
        $user = $request->user();
        $this->guardHrPermission($user, 'can_approve');
        $employeeId = $this->resolveEmployeeId($request->query('employee_id'), $request->query('employee_code'), $user);
        if (!$employeeId) {
            return response()->json(['data' => []]);
        }
        // All UNPAID claims (approved OR still under review) so the modal can
        // show a Review-&-Approve action on pending ones and a checkbox on
        // approved ones. Only approved claims are actually selectable to pay.
        $q = ExpenseClaim::query()
            ->with(['category:id,name'])
            ->where('employee_id', $employeeId)
            ->whereIn('status', ['approved', 'pending'])
            ->where(fn ($w) => $w->whereNull('settlement_status')->orWhere('settlement_status', '!=', 'paid'));
        $this->applyTenantScope($q, $user, $request->integer('branch_id') ?: null);

        return response()->json([
            'data' => $q->orderBy('id')->get()->map(function ($c) {
                // Batch pays the REMAINING payable, not the full claim — a
                // partially-paid claim only owes (sanctioned − already paid).
                $payableBase = (float) ($c->sanctioned_amount ?? $c->amount);
                $remaining   = round($payableBase - (float) $c->total_paid, 2);
                return [
                'id'            => $c->id,
                'exp_no'        => $this->expNo($c),
                'title'         => $c->title,
                'category_id'   => $c->category_id,
                'category_name' => $c->category?->name ?? $c->category_name,
                'expense_date'  => optional($c->expense_date)->format('Y-m-d'),
                // `amount` = remaining payable (what the batch will pay). The
                // full claim + already-paid are exposed for display.
                'amount'        => max(0, $remaining),
                'claim_amount'  => $payableBase,
                'paid'          => (float) $c->total_paid,
                'note'          => $c->purpose ?: $c->title,
                'attachments'   => collect($c->attachments ?? [])->count(),
                'status'        => $c->status,          // approved | pending
                'payable'       => $c->status === 'approved',
                // Which stage a pending claim is waiting on, so the UI can enable
                // "Review & Approve" only for HR-stage (manager must go first).
                'manager_status' => $c->manager_status,  // pending | approved | rejected
                'hr_status'      => $c->hr_status,
                'pending_stage'  => $c->status === 'approved'
                    ? null
                    : (($c->manager_status ?? 'pending') !== 'approved' ? 'manager' : 'hr'),
                ];
            })->values(),
        ]);
    }

    /**
     * GET /expense-claims/batch-payments — history of consolidated payments.
     */
    public function batchPayments(Request $request)
    {
        $user = $request->user();
        $this->guardHrPermission($user, 'can_view');
        $q = \App\Models\ExpenseBatchPayment::query()->with(['employee:id,first_name,last_name,display_name,emp_code', 'payments:id,batch_payment_id,expense_claim_id']);
        if ($user->client_id) $q->where('client_id', $user->client_id);
        if ($user->user_type === 'branch_user' && $user->branch_id) $q->where('branch_id', $user->branch_id);

        return response()->json([
            'data' => $q->orderByDesc('id')->limit(100)->get()->map(function ($b) {
                $claimIds = $b->payments->pluck('expense_claim_id')->all();
                $expNos = ExpenseClaim::whereIn('id', $claimIds)->pluck('claim_no', 'id');
                return [
                    'id'               => $b->id,
                    'employee_name'    => $b->employee?->display_name
                        ?: trim(($b->employee->first_name ?? '') . ' ' . ($b->employee->last_name ?? '')),
                    'employee_code'    => $b->employee?->emp_code,
                    'reference_number' => $b->reference_number,
                    'payment_type'     => $b->payment_type,
                    'total_amount'     => (float) $b->total_amount,
                    'note'             => $b->note,
                    'paid_at'          => optional($b->created_at)->toIso8601String(),
                    'count'            => count($claimIds),
                    'exp_nos'          => collect($claimIds)->map(fn ($id) => $expNos[$id] ?? ('EXP-' . str_pad((string) $id, 4, '0', STR_PAD_LEFT)))->values(),
                    'proof_url'        => $b->proof_path ? url("/api/expense-claims/batch-payments/{$b->id}/proof") : null,
                    'zoho_status'      => $b->zoho_status,
                    'zoho_expense_id'  => $b->zoho_expense_id,
                    'zoho_url'         => $b->zoho_expense_id ? $this->zohoExpenseUrl($b->zoho_expense_id) : null,
                ];
            }),
        ]);
    }

    /** Stream a batch payment's shared proof-of-payment. */
    public function batchPaymentProof(Request $request, $batchId)
    {
        $this->authenticateFromQueryToken($request);
        $b = \App\Models\ExpenseBatchPayment::findOrFail($batchId);
        $user = $request->user();
        if ($user && $user->client_id && (int) $b->client_id !== (int) $user->client_id) {
            abort(403, 'Out of tenant scope.');
        }
        $disk = \Illuminate\Support\Facades\Storage::disk('public');
        if (!$b->proof_path || !$disk->exists($b->proof_path)) {
            abort(404, 'Proof of payment not found.');
        }
        return $disk->response($b->proof_path, $b->proof_name ?: basename($b->proof_path));
    }

    /**
     * POST /expense-claims/batch-payments/{batchId}/sync-zoho
     * Push a recorded batch to Zoho Books as ONE itemised expense (one line per
     * claim, its EXP-#### in the line note). Idempotent — a batch already
     * carrying a zoho_expense_id is not re-created.
     */
    public function syncBatchPaymentToZoho(Request $request, $batchId)
    {
        $user = $request->user();
        $this->guardHrPermission($user, 'can_approve');
        $batch = \App\Models\ExpenseBatchPayment::findOrFail($batchId);
        if ($user->client_id && (int) $batch->client_id !== (int) $user->client_id) {
            abort(403, 'Out of tenant scope.');
        }
        if (!empty($batch->zoho_expense_id)) {
            return response()->json([
                'status'   => true,
                'message'  => 'This batch is already synced to Zoho Books.',
                'zoho_url' => $this->zohoExpenseUrl($batch->zoho_expense_id),
            ]);
        }
        /** @var \App\Services\ZohoBooksService $zoho */
        $zoho = app(\App\Services\ZohoBooksService::class);
        if (!$zoho->isConfigured()) {
            return response()->json(['status' => false, 'message' => 'Zoho Books is not configured.'], 422);
        }

        // Reconstruct the claims + goods/service type from the batch's payments.
        $payments = \App\Models\ExpenseClaimPayment::where('batch_payment_id', $batch->id)->get();
        $claims   = ExpenseClaim::with('category:id,name')->whereIn('id', $payments->pluck('expense_claim_id')->all())->get();
        $expenseType = $payments->first()?->expense_type ?: 'Goods';

        $this->syncBatchToZoho($batch, $claims, $expenseType);
        $batch->refresh();
        if ($batch->zoho_status !== 'synced' || empty($batch->zoho_expense_id)) {
            return response()->json(['status' => false, 'message' => 'Zoho Books sync failed — please retry (details in the server log).'], 422);
        }
        return response()->json([
            'status'   => true,
            'message'  => 'Batch synced to Zoho Books as one itemised expense.',
            'zoho_url' => $this->zohoExpenseUrl($batch->zoho_expense_id),
        ]);
    }

    /**
     * POST /expense-claims/batch-pay
     * Settle several APPROVED, unpaid claims of ONE employee with a single payout
     * (one UTR + one proof), and sync to Zoho Books as ONE itemised expense
     * (one line per claim). Each claim is marked fully paid.
     */
    public function batchPay(Request $request)
    {
        $user = $request->user();
        $this->guardHrPermission($user, 'can_approve');

        $data = $request->validate([
            'employee_id'      => ['required'],
            'claim_ids'        => ['required', 'array', 'min:1'],
            'claim_ids.*'      => ['integer'],
            'reference_number' => ['required', 'string', 'max:120'],
            'payment_type'     => ['required', 'string', 'in:Cheque,UPI,PhonePe,Bank Transfer'],
            'expense_type'     => ['required', 'string', 'in:Goods,Service'],
            'note'             => ['nullable', 'string', 'max:500'],
            // Proof must be a receipt/image — no Excel/Word (QA #111); 2 MB cap.
            'proof'            => ['required', 'file', 'max:2048', 'mimes:pdf,jpg,jpeg,png,webp'],
        ], [
            'proof.max'      => 'Proof of payment must be 2 MB or smaller.',
            'proof.uploaded' => 'Proof of payment must be 2 MB or smaller.',
            'proof.mimes'    => 'Proof of payment must be a PDF, JPG, PNG or WEBP file.',
        ]);

        $employeeId = $this->resolveEmployeeId($data['employee_id'], $request->input('employee_code'), $user);
        if (!$employeeId) {
            abort(422, 'Employee not found.');
        }

        // Load + validate the selected claims: same employee, approved, unpaid,
        // in the caller's tenant.
        $claims = ExpenseClaim::with('category:id,name')
            ->whereIn('id', $data['claim_ids'])
            ->where('employee_id', $employeeId)
            ->get();
        if ($claims->count() !== count(array_unique($data['claim_ids']))) {
            abort(422, 'Some selected claims were not found for this employee.');
        }
        foreach ($claims as $c) {
            $this->ensureTenantAccess($c, $user);
            if ($c->status !== 'approved') {
                abort(409, $this->expNo($c) . ' is not approved yet — only approved claims can be paid.');
            }
            if (($c->settlement_status ?? 'unpaid') === 'paid') {
                abort(409, $this->expNo($c) . ' is already fully paid.');
            }
        }

        // Pay the REMAINING per claim (handles partially-paid claims): payable
        // base is the sanctioned amount if set, else the claim amount, minus
        // what's already been paid. (QA #114)
        $remainingOf = fn ($c) => round((float) ($c->sanctioned_amount ?? $c->amount) - (float) $c->total_paid, 2);
        $total = round($claims->sum($remainingOf), 2);

        // Shared proof of payment (one file for the whole batch).
        $f = $request->file('proof');
        $proofName = $f->getClientOriginalName();
        $proofPath = $f->store('expense_batch_payments', 'public');

        $batch = DB::transaction(function () use ($user, $employeeId, $claims, $data, $total, $proofPath, $proofName, $remainingOf) {
            $batch = \App\Models\ExpenseBatchPayment::create([
                'client_id'        => $claims->first()->client_id,
                'branch_id'        => $claims->first()->branch_id,
                'employee_id'      => $employeeId,
                'reference_number' => trim($data['reference_number']),
                'payment_type'     => $data['payment_type'],
                'total_amount'     => $total,
                'note'             => $data['note'] ?? null,
                'proof_path'       => $proofPath,
                'proof_name'       => $proofName,
                'zoho_status'      => 'not_synced',
                'paid_by'          => $user->id,
            ]);

            foreach ($claims as $c) {
                $amt = $remainingOf($c);   // remaining payable, not the full claim
                if ($amt <= 0) continue;   // nothing left to pay on this one
                \App\Models\ExpenseClaimPayment::create([
                    'client_id'        => $c->client_id,
                    'branch_id'        => $c->branch_id,
                    'expense_claim_id' => $c->id,
                    'batch_payment_id' => $batch->id,
                    'amount'           => $amt,
                    'category_id'      => $c->category_id,
                    'category_name'    => $c->category?->name ?? $c->category_name,
                    'payment_type'     => $data['payment_type'],
                    'expense_type'     => $data['expense_type'],
                    'note'             => $data['note'] ?? ('Batch ' . trim($data['reference_number'])),
                    'proof_path'       => $proofPath,
                    'proof_name'       => $proofName,
                    'paid_by'          => $user->id,
                    'paid_at'          => now(),
                ]);
                // No batch-time deductions — the sanctioned (or claim) amount is
                // the payable base; the remaining is paid here.
                if ($c->sanctioned_amount === null) $c->sanctioned_amount = (float) $c->amount;
                $c->total_paid = round((float) $c->total_paid + $amt, 2);
                $c->settlement_status = 'paid';
                $c->settled_at = now();
                $c->save();
            }
            return $batch;
        });

        // Zoho sync is a separate, explicit step (the "Zoho Sync" button in the
        // batch history) — mirrors the single-payment flow, so HR controls when
        // the itemised expense is pushed.
        return response()->json([
            'status'  => true,
            'message' => 'Batch payment recorded — ' . $claims->count() . ' claim(s), ₹' . number_format($total, 2) . ' paid. Use “Zoho Sync” to push it to Zoho Books.',
            'batch_id'=> $batch->id,
        ]);
    }

    /**
     * Push a batch as ONE itemised Zoho expense: one line_item per claim (its
     * category = account_id), reference = UTR, then attach the batch proof +
     * each claim's receipts (first 5, Zoho's cap). Best-effort — a Zoho failure
     * leaves the payment intact and just flags the batch as not synced.
     */
    private function syncBatchToZoho(\App\Models\ExpenseBatchPayment $batch, $claims, string $expenseType): void
    {
        /** @var \App\Services\ZohoBooksService $zoho */
        $zoho = app(\App\Services\ZohoBooksService::class);
        if (!$zoho->isConfigured()) {
            return; // Zoho not set up — payment already recorded.
        }

        $expenseId = null;
        try {
            $lineItems = $claims->map(fn ($c) => [
                'account_id'  => $zoho->resolveExpenseAccountId($c->category?->name ?: ($c->category_name ?: 'Employee Reimbursement')),
                'description' => $this->expNo($c) . ' - ' . $c->title,
                'amount'      => (float) $c->amount,
            ])->values()->all();

            $payload = [
                'paid_through_account_id' => $zoho->findOrCreatePaidThroughAccountId($batch->payment_type ?: 'Bank'),
                'date'                    => now()->format('Y-m-d'),
                'reference_number'        => $batch->reference_number,
                'is_itemized_expense'     => true,
                'line_items'              => $lineItems,
                'product_type'            => strtolower($expenseType) === 'service' ? 'service' : 'goods',
                'description'             => 'Batch payment · ' . $claims->map(fn ($c) => $this->expNo($c))->implode(', '),
            ];
            $state = $zoho->orgStateCode();
            if ($state) {
                $payload['source_of_supply']      = $state;
                $payload['destination_of_supply'] = $state;
            }

            $expense   = $zoho->createExpense($payload);
            $expenseId = (string) ($expense['expense_id'] ?? '');

            if ($expenseId !== '') {
                $disk = \Illuminate\Support\Facades\Storage::disk('public');
                // Proof-of-payment first, then each claim's receipts named
                // "EXP-#### - Title" (…-2 for a claim's 2nd receipt). Zoho caps at 5.
                $receiptFiles = [];
                if ($batch->proof_path) {
                    $receiptFiles[] = ['path' => $batch->proof_path, 'name' => $batch->proof_name ?: basename($batch->proof_path)];
                }
                foreach ($claims as $c) {
                    $atts = array_values($c->attachments ?? []);
                    foreach ($atts as $i => $att) {
                        $p = is_array($att) ? ($att['path'] ?? null) : null;
                        if (empty($p)) continue;
                        $ext = pathinfo((string) $p, PATHINFO_EXTENSION);
                        $label = $this->expNo($c) . (count($atts) > 1 ? '-' . ($i + 1) : '') . ' - ' . $c->title;
                        $receiptFiles[] = ['path' => $p, 'name' => $label . ($ext ? '.' . $ext : '')];
                    }
                }
                $seen = [];
                $receiptFiles = array_values(array_filter($receiptFiles, function ($rf) use (&$seen) {
                    if (isset($seen[$rf['path']])) return false;
                    $seen[$rf['path']] = true;
                    return true;
                }));
                // /attachment accumulates, so push EVERY claim's proof + the
                // payment proof (Zoho allows up to 10 attachments per entity).
                $skipped = max(0, count($receiptFiles) - 10);
                foreach (array_slice($receiptFiles, 0, 10) as $rf) {
                    if (!$disk->exists($rf['path'])) continue;
                    try { $zoho->attachExpenseReceipt($expenseId, $disk->get($rf['path']), $rf['name']); }
                    catch (\Throwable $e) { \Illuminate\Support\Facades\Log::warning('Zoho batch attachment failed', ['batch' => $batch->id, 'file' => $rf['path'], 'error' => $e->getMessage()]); }
                }
                if ($skipped > 0) {
                    \Illuminate\Support\Facades\Log::info("Zoho 10-attachment cap: {$skipped} file(s) not pushed for batch {$batch->id}.");
                }
            }

            $batch->zoho_status     = 'synced';
            $batch->zoho_synced_at  = now();
            $batch->zoho_expense_id = $expenseId;
            $batch->save();
            \App\Models\ExpenseClaimPayment::where('batch_payment_id', $batch->id)
                ->update(['zoho_status' => 'synced', 'zoho_synced_at' => now(), 'zoho_expense_id' => $expenseId]);
        } catch (\Throwable $e) {
            if ($expenseId) { try { $zoho->deleteExpense($expenseId); } catch (\Throwable $ignore) {} }
            $batch->zoho_status = 'failed';
            $batch->save();
            \Illuminate\Support\Facades\Log::warning('Zoho batch expense sync failed', ['batch' => $batch->id, 'error' => $e->getMessage()]);
        }
    }

    /**
     * POST /expense-claims/{id}/email-reimbursement
     * Email the employee their reimbursement confirmation (breakdown + payments +
     * proof attachments). Allowed only once the claim is fully paid AND every
     * payment has been synced to Zoho Books.
     */
    public function emailReimbursement(Request $request, $id)
    {
        $user = $request->user();
        $row  = ExpenseClaim::with(['payments', 'employee', 'client'])->findOrFail($id);
        $this->ensureTenantAccess($row, $user);
        $this->guardHrPermission($user, 'can_approve');

        if ($row->status !== 'approved') {
            abort(409, 'Only an approved claim can be emailed.');
        }
        if (($row->settlement_status ?? 'unpaid') !== 'paid') {
            abort(409, 'The claim must be fully paid before emailing the reimbursement.');
        }
        $payments = $row->payments;
        if ($payments->isEmpty() || !$payments->every(fn ($p) => ($p->zoho_status ?? 'not_synced') === 'synced')) {
            abort(409, 'All payments must be synced to Zoho Books before emailing.');
        }

        $email = $row->employee?->official_email ?: $row->employee?->email;
        if (!$email) {
            return response()->json(['status' => false, 'message' => 'The employee has no email address on file.'], 422);
        }

        $employeeName = $row->employee?->display_name
            ?: trim(($row->employee?->first_name ?? '') . ' ' . ($row->employee?->last_name ?? ''))
            ?: ($row->employee_name ?: 'Employee');
        $orgName = $row->client?->name ?: config('mail.from.name', 'Cross Border Command');

        // Proof files to attach (public disk, existing only).
        $disk  = \Illuminate\Support\Facades\Storage::disk('public');
        $files = $payments->filter(fn ($p) => $p->proof_path && $disk->exists($p->proof_path))
            ->map(fn ($p) => ['path' => $p->proof_path, 'name' => $p->proof_name ?: basename($p->proof_path)])
            ->values()->all();

        try {
            \Illuminate\Support\Facades\Mail::to($email)->send(
                new \App\Mail\ExpenseReimbursementMail($row, $employeeName, $orgName, $files)
            );
        } catch (\Throwable $e) {
            return response()->json(['status' => false, 'message' => 'Could not send the email: ' . $e->getMessage()], 422);
        }

        $row->reimbursement_emailed_at = now();
        $row->save();

        return response()->json(['status' => true, 'message' => 'Reimbursement emailed to ' . $email . '.']);
    }

    /**
     * Resolve the request user from `?token=<sanctum>` so direct browser
     * link-clicks work without sending an Authorization header. Mirrors
     * CandidateController::authenticateFromQueryToken.
     */
    private function authenticateFromQueryToken(Request $request): void
    {
        if (!$request->user() && $request->query('token')) {
            $token = \Laravel\Sanctum\PersonalAccessToken::findToken($request->query('token'));
            if ($token) {
                $request->setUserResolver(fn () => $token->tokenable);
            } else {
                abort(401, 'Invalid token');
            }
        }
        if (!$request->user()) {
            abort(401, 'Unauthorized');
        }
    }

    /* ============================================================ */
    /*  MANAGER ACTIONS                                             */
    /* ============================================================ */

    public function managerApprove(Request $request, $id)
    {
        return $this->managerAct($request, $id, 'approved');
    }

    public function managerReject(Request $request, $id)
    {
        return $this->managerAct($request, $id, 'rejected');
    }

    private function managerAct(Request $request, $id, string $verdict)
    {
        $user = $request->user();
        $row = ExpenseClaim::findOrFail($id);
        $this->ensureTenantAccess($row, $user);

        $myEmployeeId = $this->currentEmployeeId($user);
        // No self-approval: an approver can't act on their OWN claim — their
        // reporting manager (the branch user) does the approval/payment.
        if ($user->user_type !== 'super_admin' && $myEmployeeId !== null && (int) $row->employee_id === (int) $myEmployeeId) {
            abort(403, 'You cannot approve your own expense claim — your reporting manager (branch user) will approve it.');
        }
        $isAssignedManager = $myEmployeeId !== null && (int) $row->manager_id === (int) $myEmployeeId;
        // Only the assigned manager (or super_admin) may act — EXCEPT a row with
        // no assigned employee manager, which the branch admin approves as the
        // de-facto reporting manager (needs HR-approve rights).
        if ($user->user_type !== 'super_admin' && !$isAssignedManager) {
            if ($row->manager_id === null) {
                $this->guardHrPermission($user, 'can_approve');
            } else {
                abort(403, 'You are not the assigned reporting manager for this claim.');
            }
        }
        if ($row->manager_status !== 'pending') {
            abort(409, 'This claim has already been actioned by the manager.');
        }

        // A rejection reason is mandatory for auditability (parity with the
        // frontend + Notifications reject flow); approvals may omit a note.
        $data = $request->validate([
            'comment' => [$verdict === 'rejected' ? 'required' : 'nullable', 'string', 'max:1000'],
        ], [
            'comment.required' => 'A reason is required to reject this claim.',
        ]);

        $row->manager_status   = $verdict;
        $row->manager_acted_at = now();
        // Record the exact logged-in user who acted, so the audit log names them
        // whoever they are — assigned manager, branch admin, or anyone else.
        $row->manager_acted_by = $user->id;
        $row->manager_comment  = $data['comment'] ?? null;
        // Rejection at the manager stage closes the claim.
        if ($verdict === 'rejected') {
            $row->status = 'rejected';
        }
        $row->save();

        $row->load(['employee.department', 'manager', 'category', 'creator', 'hrUser']);
        return response()->json($this->serialize($row));
    }

    /* ============================================================ */
    /*  HR / FINANCE ACTIONS                                        */
    /* ============================================================ */

    public function hrApprove(Request $request, $id)
    {
        return $this->hrAct($request, $id, 'approved');
    }

    public function hrReject(Request $request, $id)
    {
        return $this->hrAct($request, $id, 'rejected');
    }

    private function hrAct(Request $request, $id, string $verdict)
    {
        $user = $request->user();
        $row = ExpenseClaim::findOrFail($id);
        $this->ensureTenantAccess($row, $user);
        $this->guardHrPermission($user, 'can_approve');
        // No self-approval — the branch user (reporting manager) approves it.
        $myEmp = $this->currentEmployeeId($user);
        if ($user->user_type !== 'super_admin' && $myEmp !== null && (int) $row->employee_id === (int) $myEmp) {
            abort(403, 'You cannot approve your own expense claim — your reporting manager (branch user) will approve it.');
        }

        if ($verdict === 'approved' && $row->manager_status !== 'approved') {
            abort(409, 'Manager must approve this claim before HR / Finance can approve it.');
        }
        if ($row->hr_status !== 'pending') {
            abort(409, 'This claim has already been actioned by HR / Finance.');
        }

        // A rejection reason is mandatory for auditability (parity with the
        // frontend + Notifications reject flow); approvals may omit a note.
        // On APPROVAL, HR also locks the one-time settlement adjustments here
        // (additions / deductions) — after this the claim is payment-only.
        $data = $request->validate([
            'comment'             => [$verdict === 'rejected' ? 'required' : 'nullable', 'string', 'max:1000'],
            'deductions'          => ['nullable', 'array'],
            'deductions.*.amount' => ['required_with:deductions', 'numeric', 'min:0'],
            'deductions.*.reason' => ['nullable', 'string', 'max:500'],
            'additions'           => ['nullable', 'array'],
            'additions.*.amount'  => ['required_with:additions', 'numeric', 'min:0', 'max:100000'],
            'additions.*.reason'  => ['nullable', 'string', 'max:500'],
        ], [
            'comment.required' => 'A reason is required to reject this claim.',
        ]);

        // Compute + validate the settlement adjustments when approving.
        $applyAdjust   = $verdict === 'approved';
        $deductionRows = [];  $deduction = 0.0;
        $additionRows  = [];  $addition  = 0.0;
        $sanctioned    = null;
        if ($applyAdjust) {
            [$deductionRows, $deduction, $dedErr] = $this->normaliseAdjustments($data['deductions'] ?? [], 'deduction');
            if ($dedErr) return $dedErr;
            [$additionRows, $addition, $addErr] = $this->normaliseAdjustments($data['additions'] ?? [], 'addition');
            if ($addErr) return $addErr;
            $sanctioned = round((float) $row->amount - $deduction + $addition, 2);
            if ($sanctioned <= 0.005) {
                return response()->json([
                    'status'  => false,
                    'message' => 'Deductions cannot exceed the claimed amount plus additions — net payable must be greater than zero.',
                    'errors'  => ['deductions' => ['Net payable must be greater than zero.']],
                ], 422);
            }
        }

        DB::transaction(function () use ($row, $user, $verdict, $data, $applyAdjust, $sanctioned, $deduction, $deductionRows, $addition, $additionRows) {
            $row->hr_status   = $verdict;
            $row->hr_user_id  = $user->id;
            $row->hr_acted_at = now();
            $row->hr_comment  = $data['comment'] ?? null;
            $row->status      = $verdict; // hr stage is the final word
            if ($applyAdjust) {
                $row->sanctioned_amount = $sanctioned;
                $row->deduction_amount  = max(0, $deduction);
                $row->deductions        = $deductionRows;
                $row->addition_amount   = max(0, $addition);
                $row->additions         = $additionRows;
                $row->deduction_reason  = $deductionRows
                    ? implode(' · ', array_map(fn ($d) => number_format($d['amount'], 2) . ': ' . $d['reason'], $deductionRows))
                    : null;
            }
            $row->save();
        });

        $row->load(['employee.department', 'manager', 'category', 'creator', 'hrUser']);
        return response()->json($this->serialize($row));
    }

    /* ============================================================ */
    /*  HELPERS                                                     */
    /* ============================================================ */

    /**
     * Map the authenticated User to their Employee row via Employee.user_id.
     * Returns null when the user isn't linked to an employee record (e.g.
     * super_admin, client_admin without a personal Employee profile).
     */
    private function currentEmployeeId($user): ?int
    {
        if (!$user) return null;
        return Employee::where('user_id', $user->id)->value('id');
    }

    /**
     * Build the transitive set of employee ids that report (directly or
     * indirectly) to the given root manager. Returns an empty array when
     * the root is null. The root itself is NOT included — managers don't
     * own their own claims in the "team" view (those live under My Mine).
     *
     * Iterative BFS over `reporting_manager_id` keeps it portable across
     * MySQL / SQLite and avoids dialect-specific recursive CTEs. The chain
     * is usually 2-4 levels deep, so a handful of round-trips is fine.
     */
    private function downstreamEmployeeIds(?int $rootEmployeeId): array
    {
        if (!$rootEmployeeId) return [];
        $all = [];
        $frontier = [$rootEmployeeId];
        while (!empty($frontier)) {
            $children = Employee::whereIn('reporting_manager_id', $frontier)
                ->pluck('id')->all();
            $children = array_map('intval', $children);
            $new = array_values(array_diff($children, $all, [$rootEmployeeId]));
            if (empty($new)) break;
            $all = array_merge($all, $new);
            $frontier = $new;
        }
        return $all;
    }

    /**
     * Accept either a numeric Employee.id, a string EMP- code, or both, and
     * return the resolved numeric id (or null when neither resolves). The
     * frontend often only knows the EMP- code from the URL slug, so the
     * controller takes responsibility for the lookup.
     */
    private function resolveEmployeeId($idInput, $codeInput, $user = null): ?int
    {
        // Numeric path — accept ints and all-digit strings.
        if ($idInput !== null && $idInput !== '') {
            if (is_numeric($idInput)) {
                return (int) $idInput;
            }
            // Some callers send the EMP- code in employee_id by mistake;
            // accept it transparently rather than error out.
            $codeInput = $codeInput ?: $idInput;
        }
        if ($codeInput) {
            // emp_code is unique PER CLIENT only (see the
            // `employees_client_emp_code_unique` index), so resolving it
            // without a tenant scope can match a DIFFERENT client's employee
            // that happens to share the same EMP-#### code. That wrong row
            // then fails the "your own employee record" ownership guard with a
            // confusing 403. Scope the lookup to the caller's client (super
            // admins stay unscoped — they legitimately act across tenants).
            $q = Employee::where('emp_code', $codeInput);
            if ($user && $user->user_type !== 'super_admin' && $user->client_id) {
                $q->where('client_id', $user->client_id);
            }
            $found = $q->value('id');
            if ($found) return (int) $found;
        }
        return null;
    }

    /**
     * Walk up the parent_id chain on `modules` looking for `master.expense_category`.
     * Used as a sanity check; the actual gate is the per-user permissions row.
     */
    private function guardHrPermission($user, string $perm): void
    {
        if (!$user) abort(401, 'Authentication required');
        if ($user->user_type === 'super_admin') return;

        // Use the existing hr.expense module slug if present; otherwise allow
        // any client-admin / branch-user (they're already past tenant scope).
        $moduleId = Module::where('slug', 'hr.expense')->value('id');
        if (!$moduleId) {
            // Fall back to "is this an admin-tier user?" — keeps the feature
            // usable on installs where the hr.expense module hasn't been
            // seeded into the modules table yet.
            if (in_array($user->user_type, ['client_admin', 'client_user', 'branch_user'], true)) {
                return;
            }
            abort(403, 'HR module not registered.');
        }
        $hasPerm = Permission::where('user_id', $user->id)
            ->where('module_id', $moduleId)
            ->where($perm, true)
            ->exists();
        if (!$hasPerm) {
            abort(403, "You do not have permission to perform this action ({$perm}).");
        }
    }

    private function ensureTenantAccess(ExpenseClaim $row, $user): void
    {
        if (!$user) abort(401);
        if ($user->user_type === 'super_admin') return;

        if (in_array($user->user_type, ['client_admin', 'client_user'], true)) {
            if ($row->client_id !== null && $row->client_id !== $user->client_id) {
                abort(403, 'Out of tenant scope.');
            }
            return;
        }

        if (in_array($user->user_type, ['branch_user', 'employee'], true)) {
            // Every branch is an isolated peer — branch users + employees may
            // only reach their own branch's rows (plus rows they own / manage).
            if ($row->client_id !== null && $row->client_id !== $user->client_id) {
                abort(403, 'Out of tenant scope.');
            }
            if ($row->branch_id !== null) {
                $allowed = $row->branch_id === $user->branch_id;
                // Owner / assigned manager always have access regardless of
                // branch (e.g. claims created by the user themselves).
                $myEmployeeId = $this->currentEmployeeId($user);
                if (!$allowed
                    && $row->employee_id !== $myEmployeeId
                    && $row->manager_id !== $myEmployeeId) {
                    abort(403, 'Out of tenant scope.');
                }
            }
        }
    }

    private function applyTenantScope($q, $user, ?int $branchFilter = null): void
    {
        if (!$user) return;
        if ($user->user_type === 'super_admin') {
            if ($branchFilter !== null) $q->where('branch_id', $branchFilter);
            return;
        }

        if (in_array($user->user_type, ['client_admin', 'client_user'], true)) {
            $q->where(function ($w) use ($user) {
                $w->whereNull('client_id')->orWhere('client_id', $user->client_id);
            });
            $this->applySwitcherBranchFilter($q, $user, $branchFilter);
            return;
        }

        if (in_array($user->user_type, ['branch_user', 'employee'], true)) {
            // Every branch is an isolated peer — globals + client-level rows
            // + own branch's rows (+ rows the user owns / manages).
            $clientId = $user->client_id;
            $branchId = $user->branch_id;
            $myEmployeeId = $this->currentEmployeeId($user);

            $q->where(function ($w) use ($clientId, $branchId, $myEmployeeId) {
                $w->whereNull('client_id')
                  ->orWhere(function ($ww) use ($clientId, $branchId, $myEmployeeId) {
                      $ww->where('client_id', $clientId)
                         ->where(function ($wb) use ($branchId, $myEmployeeId) {
                             $wb->whereNull('branch_id')
                                ->orWhere('branch_id', $branchId);
                             if ($myEmployeeId) {
                                 $wb->orWhere('employee_id', $myEmployeeId)
                                    ->orWhere('manager_id', $myEmployeeId);
                             }
                         });
                  });
            });
            return;
        }

        $q->whereRaw('1 = 0');
    }

    /** BranchSwitcher narrowing — see RecruitmentController for full notes. */
    private function applySwitcherBranchFilter($q, $user, ?int $branchFilter): void
    {
        if ($branchFilter === null) return;
        $belongsToClient = Branch::where('id', $branchFilter)
            ->where('client_id', $user->client_id)
            ->exists();
        if (!$belongsToClient) return;
        $q->where('branch_id', $branchFilter);
    }

    /**
     * Generate the next EXP-### sequence per (client_id, branch_id) tuple so
     * each tenant gets its own numbering independently.
     *
     * IMPORTANT: must be called from within a DB::transaction(...) — the
     * lockForUpdate() row-lock is only held until the surrounding
     * transaction commits. Without a transaction, two concurrent submitters
     * in the same tenant would both compute the same next number, producing
     * duplicate claim_no values. Caller in store() wraps the allocate+create
     * pair in DB::transaction() for exactly this reason.
     */
    /** Sequential EXP code. Shared allocator — see \App\Support\DocumentNumber. */
    private function nextClaimNo(?int $clientId, ?int $branchId): string
    {
        return \App\Support\DocumentNumber::next(
            \App\Models\ExpenseClaim::class,
            'claim_no',
            'EXP',
            $clientId,
            $branchId,
        );
    }

    /**
     * Shape a row for the API response. Flattens employee/manager/category
     * names so the frontend can render the table without nested dereferences.
     */
    private function serialize(ExpenseClaim $row): array
    {
        $employee = $row->employee;
        $manager  = $row->manager;
        // Prefer the live relation; fall back to the name snapshot stored on
        // the claim so a deleted (soft or hard) employee's name still shows.
        $employeeName = ($employee
            ? ($employee->display_name
                ?: trim(($employee->first_name ?? '') . ' ' . ($employee->last_name ?? '')))
            : null) ?: $row->employee_name;
        $managerName = $manager
            ? ($manager->display_name
                ?: trim(($manager->first_name ?? '') . ' ' . ($manager->last_name ?? '')))
            : null;
        // No EMPLOYEE manager, but the employee reports to a BRANCH USER
        // (reporting_manager_user_id) — surface that user's name so a PENDING
        // stage reads "Awaiting <de-facto manager>" instead of "manager review".
        if (!$managerName && $employee && $employee->reporting_manager_user_id) {
            $managerName = $employee->relationLoaded('reportingManagerUser')
                ? $employee->reportingManagerUser?->name
                : \App\Models\User::whereKey($employee->reporting_manager_user_id)->value('name');
        }
        // Once acted, prefer the ACTUAL approver — whoever logged in and approved
        // or rejected the manager stage (assigned manager, branch admin, anyone).
        if ($row->manager_status !== 'pending' && $row->manager_acted_by) {
            $actorName = $row->relationLoaded('managerActor')
                ? $row->managerActor?->name
                : \App\Models\User::whereKey($row->manager_acted_by)->value('name');
            if ($actorName) $managerName = $actorName;
        }
        return [
            'id'              => $row->id,
            'claim_no'        => $row->claim_no,
            'employee_id'     => $row->employee_id,
            'employee_name'   => $employeeName,
            'employee_code'   => $employee?->emp_code,
            'department_id'   => $employee?->department_id,
            'department_name' => $employee?->department?->name,
            'manager_id'      => $row->manager_id,
            // The branch USER acting as reporting manager (when no employee
            // manager) — lets the SPA tell whether the viewer is that manager.
            'reporting_manager_user_id' => $employee?->reporting_manager_user_id,
            'manager_name'    => $managerName,
            'category_id'     => $row->category_id,
            'category_name'   => $row->category?->name ?? $row->category_name,
            // If this claim reimburses a company advance, link back to it.
            'reimbursement_for' => $row->reimbursedAdvance
                ? ['id' => $row->reimbursedAdvance->id, 'advance_no' => $row->reimbursedAdvance->advance_no]
                : null,
            'currency'        => $row->currency,
            'project'         => $row->project,
            'payment_method'  => $row->payment_method,
            'title'           => $row->title,
            'amount'          => (float) $row->amount,
            'expense_date'    => optional($row->expense_date)->format('Y-m-d'),
            'vendor'          => $row->vendor,
            'purpose'         => $row->purpose,
            'attachments'     => collect($row->attachments ?? [])->values()->map(function ($a, $i) use ($row) {
                // The download URL points at the Laravel route which streams
                // the file via query-token auth. The browser-side anchor
                // appends `?token=<sanctum>` before opening, identical to
                // the candidate CV pattern.
                return [
                    'name' => $a['name'] ?? null,
                    'size' => $a['size'] ?? null,
                    'url'  => url("/api/expense-claims/{$row->id}/attachments/{$i}"),
                ];
            })->all(),
            'status'          => $row->status,
            'manager_status'  => $row->manager_status,
            'manager_acted_at'=> optional($row->manager_acted_at)->toIso8601String(),
            'manager_comment' => $row->manager_comment,
            'hr_status'       => $row->hr_status,
            'hr_user_id'      => $row->hr_user_id,
            'hr_user_name'    => $row->hrUser?->name,
            'hr_acted_at'     => optional($row->hr_acted_at)->toIso8601String(),
            'hr_comment'      => $row->hr_comment,
            'created_by'      => $row->created_by,
            'creator_name'    => $row->creator?->name,
            'created_at'      => optional($row->created_at)->toIso8601String(),
            // ── Settlement (post-approval payment) ──
            'sanctioned_amount' => $row->sanctioned_amount !== null ? (float) $row->sanctioned_amount : null,
            'deduction_amount'  => (float) $row->deduction_amount,
            'deduction_reason'  => $row->deduction_reason,
            'total_paid'        => (float) $row->total_paid,
            'settlement_status' => $row->settlement_status ?: 'unpaid',
            'settled_at'        => optional($row->settled_at)->toIso8601String(),
            'reimbursement_emailed_at' => optional($row->reimbursement_emailed_at)->toIso8601String(),
            // Every recorded payment pushed to Zoho Books? (gates the "Email" action)
            'zoho_all_synced'   => (function () use ($row) {
                $payments = $row->relationLoaded('payments') ? $row->payments : $row->payments()->get();
                return $payments->isNotEmpty() && $payments->every(fn ($p) => ($p->zoho_status ?? 'not_synced') === 'synced');
            })(),
            // Zoho sync state for the list column: na (no payments) | pending
            // (none synced) | partial (some) | completed (all).
            'zoho_sync'         => (function () use ($row) {
                $payments = $row->relationLoaded('payments') ? $row->payments : $row->payments()->get();
                if ($payments->isEmpty()) return 'na';
                $synced = $payments->filter(fn ($p) => ($p->zoho_status ?? 'not_synced') === 'synced')->count();
                if ($synced === 0) return 'pending';
                return $synced === $payments->count() ? 'completed' : 'partial';
            })(),
            // Remaining to pay against the sanctioned amount (once sanctioned is set).
            'remaining_amount'  => $row->sanctioned_amount !== null
                ? round((float) $row->sanctioned_amount - (float) $row->total_paid, 2)
                : null,
            // Compact payout list for the Approval Audit Log — one entry per
            // recorded payment: how much, by whom, and when.
            'payments'          => (function () use ($row) {
                $ps = $row->relationLoaded('payments') ? $row->payments : $row->payments()->with('payer')->get();
                return $ps->map(fn ($p) => [
                    'amount'       => (float) $p->amount,
                    'method'       => $p->method ?? null,
                    'paid_by_name' => $p->payer?->name,
                    'paid_by_role' => $p->payer?->user_type,
                    'paid_at'      => optional($p->paid_at ?? $p->created_at)->toIso8601String(),
                ])->values()->all();
            })(),
        ];
    }

    /* ============================================================ */
    /*  SETTLEMENT — post-approval payment (partial payments)        */
    /* ============================================================ */

    /**
     * GET /expense-claims/{id}/settlement
     * The settlement state for the Record-Payment form: the claimed amount, the
     * sanctioned amount + deduction (once set), how much is paid/remaining, and
     * the list of installment payments made so far.
     */
    public function settlement(Request $request, $id)
    {
        $user = $request->user();
        $row  = ExpenseClaim::with(['payments.payer', 'payments.category', 'employee', 'category'])->findOrFail($id);
        $this->ensureTenantAccess($row, $user);

        // Employee details are fetched LIVE from the employee record (by
        // employee_id), so a name change reflects here. The stored snapshot is
        // only a fallback for a since-deleted employee. Mirrors serialize().
        $employee     = $row->employee;
        $employeeName = ($employee
            ? ($employee->display_name ?: trim(($employee->first_name ?? '') . ' ' . ($employee->last_name ?? '')))
            : null) ?: $row->employee_name;

        return response()->json([
            'id'                => $row->id,
            'claim_no'          => $row->claim_no ?: ('#' . $row->id),
            'title'             => $row->title,
            'employee_name'     => $employeeName,
            'expense_date'      => optional($row->expense_date)->format('Y-m-d'),
            'currency'          => $row->currency,
            'claimed_amount'    => (float) $row->amount,
            'purpose'           => $row->purpose,
            'vendor'            => $row->vendor,
            'project'           => $row->project,
            'category_id'       => $row->category_id,
            'category_name'     => $row->category?->name ?? $row->category_name,
            'sanctioned_amount' => $row->sanctioned_amount !== null ? (float) $row->sanctioned_amount : null,
            'deduction_amount'  => (float) $row->deduction_amount,
            'deduction_reason'  => $row->deduction_reason,
            'deductions'        => collect($row->deductions ?? [])->map(fn ($d) => [
                'amount' => (float) ($d['amount'] ?? 0),
                'reason' => (string) ($d['reason'] ?? ''),
            ])->values()->all(),
            'addition_amount'   => (float) $row->addition_amount,
            'additions'         => collect($row->additions ?? [])->map(fn ($d) => [
                'amount' => (float) ($d['amount'] ?? 0),
                'reason' => (string) ($d['reason'] ?? ''),
            ])->values()->all(),
            'total_paid'        => (float) $row->total_paid,
            'remaining_amount'  => $row->sanctioned_amount !== null
                ? round((float) $row->sanctioned_amount - (float) $row->total_paid, 2)
                : null,
            'settlement_status' => $row->settlement_status ?: 'unpaid',
            'status'            => $row->status,
            'manager_status'    => $row->manager_status,
            'hr_status'         => $row->hr_status,
            // The employee's uploaded proof/receipt documents — shown in the form so
            // the payer can verify before recording the payment. Tokenised route.
            'attachments'       => collect($row->attachments ?? [])->values()->map(fn ($a, $i) => [
                'name' => $a['name'] ?? ('Attachment ' . ($i + 1)),
                'size' => $a['size'] ?? null,
                'url'  => url("/api/expense-claims/{$row->id}/attachments/{$i}"),
            ])->all(),
            'payments'          => $row->payments->map(fn ($p) => [
                'id'           => $p->id,
                'amount'       => (float) $p->amount,
                // Live from the category master (by category_id); snapshot is a
                // fallback for a since-deleted category only.
                'category_name'=> $p->category?->name ?? $p->category_name,
                'payment_type' => $p->payment_type,
                'expense_type' => $p->expense_type,
                'note'         => $p->note,
                'proof_name'   => $p->proof_name,
                'proof_url'    => $p->proof_path ? url("/api/expense-claims/payments/{$p->id}/proof") : null,
                'zoho_status'  => $p->zoho_status ?: 'not_synced',
                'zoho_synced_at' => optional($p->zoho_synced_at)->toIso8601String(),
                'zoho_expense_url' => $p->zoho_expense_id ? $this->zohoExpenseUrl((string) $p->zoho_expense_id) : null,
                'paid_by_name' => $p->payer?->name,
                'paid_by_role' => $p->payer?->user_type,
                'paid_at'      => optional($p->paid_at)->toIso8601String(),
            ])->all(),
        ]);
    }

    /**
     * POST /expense-claims/{id}/set-deductions
     * Lock the ONE-TIME deduction on an approved claim WITHOUT recording a payment.
     * Computes the sanctioned amount (claim − Σ deductions) and freezes it so every
     * later payment pays against a fixed net-payable. Can only run before the first
     * payment (i.e. while the sanctioned amount is still unset).
     *
     * Body: deductions[] (each { amount, reason }).
     */
    public function setDeductions(Request $request, $id)
    {
        $user = $request->user();
        $row  = ExpenseClaim::findOrFail($id);
        $this->ensureTenantAccess($row, $user);
        $this->guardHrPermission($user, 'can_approve');

        if ($row->status !== 'approved') {
            abort(409, 'Only an approved claim can be settled. Approve it first.');
        }
        if ($row->sanctioned_amount !== null) {
            abort(409, 'The deduction is already locked for this claim.');
        }

        $data = $request->validate([
            'deductions'          => ['nullable', 'array'],
            'deductions.*.amount' => ['required_with:deductions', 'numeric', 'min:0'],
            'deductions.*.reason' => ['nullable', 'string', 'max:500'],
            'additions'           => ['nullable', 'array'],
            'additions.*.amount'  => ['required_with:additions', 'numeric', 'min:0', 'max:100000'],
            'additions.*.reason'  => ['nullable', 'string', 'max:500'],
        ]);

        [$deductionRows, $deduction, $dedErr] = $this->normaliseAdjustments($data['deductions'] ?? [], 'deduction');
        if ($dedErr) return $dedErr;
        [$additionRows, $addition, $addErr] = $this->normaliseAdjustments($data['additions'] ?? [], 'addition');
        if ($addErr) return $addErr;

        $sanctioned = round((float) $row->amount - $deduction + $addition, 2);
        if ($sanctioned <= 0.005) {
            return response()->json([
                'status'  => false,
                'message' => 'Deductions cannot exceed the claimed amount plus additions — net payable must be greater than zero.',
                'errors'  => ['deductions' => ['Net payable must be greater than zero.']],
            ], 422);
        }

        $row->sanctioned_amount = $sanctioned;
        $row->deduction_amount  = max(0, $deduction);
        $row->deductions        = $deductionRows;
        $row->addition_amount   = max(0, $addition);
        $row->additions         = $additionRows;
        $row->deduction_reason  = $deductionRows
            ? implode(' · ', array_map(fn ($d) => number_format($d['amount'], 2) . ': ' . $d['reason'], $deductionRows))
            : null;
        $row->save();

        $row->load(['employee.department', 'manager', 'category', 'creator', 'hrUser']);
        return response()->json([
            'status'  => true,
            'message' => 'Locked — net payable ₹' . number_format($sanctioned, 2) . '. Add a payment to disburse.',
            'data'    => $this->serialize($row),
        ]);
    }

    /**
     * Normalise an itemised adjustments array (deductions / additions): keep only
     * rows with amount > 0, require a reason for each, and return
     * [rows, total, errorResponse|null]. `$kind` names the field in the 422.
     */
    private function normaliseAdjustments(array $items, string $kind): array
    {
        $rows  = [];
        $total = 0.0;
        $field = $kind === 'addition' ? 'additions' : 'deductions';
        foreach ($items as $d) {
            $amt = round((float) ($d['amount'] ?? 0), 2);
            if ($amt <= 0.005) continue;
            if (empty(trim((string) ($d['reason'] ?? '')))) {
                return [[], 0.0, response()->json([
                    'status'  => false,
                    'message' => 'Each ' . $kind . ' needs a reason.',
                    'errors'  => [$field => ['Every ' . $kind . ' must have a reason.']],
                ], 422)];
            }
            $rows[] = ['amount' => $amt, 'reason' => trim((string) $d['reason'])];
            $total += $amt;
        }
        return [$rows, round($total, 2), null];
    }

    /**
     * POST /expense-claims/{id}/settle
     * Record ONE settlement installment against an approved claim. The FIRST call
     * also sets the sanctioned amount (+ deduction reason when it's less than the
     * claim). Partial payments are allowed until the sanctioned amount is met.
     *
     * Body: sanctioned_amount (first payment only), deduction_reason (if reduced),
     *       amount, category_id?, payment_type, expense_type, note.
     */
    public function settle(Request $request, $id)
    {
        $user = $request->user();
        $row  = ExpenseClaim::findOrFail($id);
        $this->ensureTenantAccess($row, $user);
        // Same right as HR approval for now (may be split into can_settle later).
        $this->guardHrPermission($user, 'can_approve');
        // No self-payment — the branch user (reporting manager) records it.
        $myEmp = $this->currentEmployeeId($user);
        if ($user->user_type !== 'super_admin' && $myEmp !== null && (int) $row->employee_id === (int) $myEmp) {
            abort(403, 'You cannot record a payment for your own claim — your reporting manager (branch user) will do it.');
        }

        if ($row->status !== 'approved') {
            abort(409, 'Only an approved claim can be paid. Approve it first.');
        }
        if (($row->settlement_status ?? 'unpaid') === 'paid') {
            abort(409, 'This claim is already fully paid.');
        }

        $firstPayment = $row->sanctioned_amount === null;

        $data = $request->validate([
            // Itemised deductions / additions (first payment only) — each has an
            // amount + reason. Net payable = claim − Σ deductions + Σ additions.
            'deductions'          => ['nullable', 'array'],
            'deductions.*.amount' => ['required_with:deductions', 'numeric', 'min:0'],
            'deductions.*.reason' => ['nullable', 'string', 'max:500'],
            'additions'           => ['nullable', 'array'],
            'additions.*.amount'  => ['required_with:additions', 'numeric', 'min:0', 'max:100000'],
            'additions.*.reason'  => ['nullable', 'string', 'max:500'],
            'amount'              => ['required', 'numeric', 'min:0.01'],
            'category_id'         => ['required', 'integer'],
            // Payment method used to disburse the reimbursement.
            'payment_type'        => ['required', 'string', 'in:Cheque,UPI,PhonePe,Bank Transfer'],
            'expense_type'        => ['required', 'string', 'in:Goods,Service'],
            'note'                => ['required', 'string', 'max:500'],
            // Proof of payment — the receipt / transfer confirmation (mandatory).
            // A receipt document or a photo of one only: spreadsheets and Word
            // files are not evidence of a payment, and the picker used to let a
            // .xlsx through (CBC #77). Mirrors PROOF_EXTS on the client.
            // 2 MB cap (matches attachments + stays under PHP's upload limit, so
            // it never fails with the cryptic "The proof failed to upload"). QA #100
            'proof'               => ['required', 'file', 'max:2048', 'mimes:pdf,jpg,jpeg,png'],
        ], [
            'proof.max'      => 'Proof of payment must be 2 MB or smaller.',
            'proof.uploaded' => 'Proof of payment must be 2 MB or smaller.',
            'proof.mimes'    => 'Proof of payment must be a PDF, JPG, JPEG or PNG file.',
        ]);

        // Normalise deductions + additions (first payment only). Net payable =
        // claim − Σ deductions + Σ additions.
        $deductionRows = [];
        $deduction     = 0.0;
        $additionRows  = [];
        $addition      = 0.0;
        if ($firstPayment) {
            [$deductionRows, $deduction, $dedErr] = $this->normaliseAdjustments($data['deductions'] ?? [], 'deduction');
            if ($dedErr) return $dedErr;
            [$additionRows, $addition, $addErr] = $this->normaliseAdjustments($data['additions'] ?? [], 'addition');
            if ($addErr) return $addErr;
            if (round((float) $row->amount - $deduction + $addition, 2) <= 0.005) {
                return response()->json([
                    'status'  => false,
                    'message' => 'Deductions cannot exceed the claimed amount plus additions — net payable must be greater than zero.',
                    'errors'  => ['deductions' => ['Net payable must be greater than zero.']],
                ], 422);
            }
        }

        // Sanctioned = claim − Σ deductions + Σ additions (fixed on the first payment).
        $sanctioned = $firstPayment ? round((float) $row->amount - $deduction + $addition, 2) : (float) $row->sanctioned_amount;

        $pay       = round((float) $data['amount'], 2);
        $remaining = round($sanctioned - (float) $row->total_paid, 2);
        if ($pay > $remaining + 0.005) {
            return response()->json([
                'status'  => false,
                'message' => 'Payment (' . number_format($pay, 2) . ') exceeds the remaining amount (' . number_format($remaining, 2) . ').',
                'errors'  => ['amount' => ['Cannot pay more than the remaining amount.']],
            ], 422);
        }

        // Resolve the payment's category (defaults to the claim's).
        $categoryId   = $data['category_id'] ?? $row->category_id;
        $categoryName = $row->category_name;
        if (!empty($data['category_id'])) {
            $cat = \App\Models\Masters\ExpenseCategories::find($data['category_id']);
            if ($cat) $categoryName = $cat->name;
        }

        // Proof of payment — stored on the public disk; only name/path are kept and
        // the URL is built per-request (query-token route) like the claim attachments.
        $proofPath = null;
        $proofName = null;
        if ($request->hasFile('proof')) {
            $f = $request->file('proof');
            $proofName = $f->getClientOriginalName();
            $proofPath = $f->store('expense_claim_payments/' . $row->id, 'public');
        }

        DB::transaction(function () use ($row, $user, $firstPayment, $sanctioned, $deduction, $deductionRows, $addition, $additionRows, $pay, $data, $categoryId, $categoryName, $proofPath, $proofName) {
            if ($firstPayment) {
                $row->sanctioned_amount = $sanctioned;
                $row->deduction_amount  = max(0, $deduction);
                $row->deductions        = $deductionRows;
                $row->addition_amount   = max(0, $addition);
                $row->additions         = $additionRows;
                // A combined reason string kept for legacy display / audit.
                $row->deduction_reason  = $deductionRows
                    ? implode(' · ', array_map(fn ($d) => number_format($d['amount'], 2) . ': ' . $d['reason'], $deductionRows))
                    : null;
            }

            \App\Models\ExpenseClaimPayment::create([
                'client_id'        => $row->client_id,
                'branch_id'        => $row->branch_id,
                'expense_claim_id' => $row->id,
                'amount'           => $pay,
                'category_id'      => $categoryId,
                'category_name'    => $categoryName,
                'payment_type'     => $data['payment_type'],
                'expense_type'     => $data['expense_type'],
                'note'             => $data['note'] ?? null,
                'proof_path'       => $proofPath,
                'proof_name'       => $proofName,
                'paid_by'          => $user->id,
                'paid_at'          => now(),
            ]);

            $row->total_paid = round((float) $row->total_paid + $pay, 2);
            $paidUp = $row->total_paid + 0.005 >= (float) $row->sanctioned_amount;
            $row->settlement_status = $paidUp ? 'paid' : 'partial';
            $row->settled_at = $paidUp ? now() : null;
            $row->save();
        });

        $row->load(['employee.department', 'manager', 'category', 'creator', 'hrUser']);
        return response()->json([
            'status'  => true,
            'message' => $row->settlement_status === 'paid'
                ? 'Payment recorded — claim fully paid.'
                : 'Payment recorded — ₹' . number_format((float) $row->total_paid, 2) . ' of ₹' . number_format((float) $row->sanctioned_amount, 2) . ' paid.',
            'data'    => $this->serialize($row),
        ]);
    }

    /**
     * Render the on-screen Expense / Advance export as a real PDF. (#166)
     *
     * "Export ▸ PDF" used to open a print window and call window.print(), so the
     * user got a print dialog and had to know to choose "Save as PDF" — the
     * report was never actually exported, and a pop-up blocker stopped it
     * outright. Every other PDF in this app is produced server-side with dompdf
     * and streamed back as a download; this brings the expense export in line.
     *
     * The already-formatted headers/rows come FROM the screen rather than being
     * re-queried here, deliberately: the export must contain exactly what the
     * user is looking at, and the module toggle, status tab, date range and
     * search box are all client-side state. Re-deriving that server-side would
     * be a second implementation of the same filtering, free to disagree with
     * the first. The Blade escapes every cell, so nothing in the payload can
     * reach the document as markup.
     */
    public function exportPdf(Request $request)
    {
        $data = $request->validate([
            'title'     => ['required', 'string', 'max:200'],
            'meta'      => ['nullable', 'string', 'max:300'],
            'filename'  => ['nullable', 'string', 'max:120'],
            'headers'   => ['required', 'array', 'min:1', 'max:40'],
            'headers.*' => ['nullable', 'string', 'max:120'],
            /* Bounded so one export cannot hold a worker open indefinitely —
               dompdf is memory-bound and 5k rows is already a very large
               document. */
            'rows'      => ['present', 'array', 'max:5000'],
            'rows.*'    => ['array', 'max:40'],
            'rows.*.*'  => ['nullable', 'string', 'max:500'],
        ]);

        $pdf = \Barryvdh\DomPDF\Facade\Pdf::loadView('pdf.expense-export', [
            'title'   => $data['title'],
            'meta'    => $data['meta'] ?? '',
            'headers' => $data['headers'],
            'rows'    => $data['rows'] ?? [],
        ])->setPaper('a4', 'landscape');

        // Filename comes from the client; strip it to a safe basename so it
        // cannot smuggle a path or header break into Content-Disposition.
        $name = preg_replace('/[^A-Za-z0-9._-]+/', '_', (string) ($data['filename'] ?? 'expense-export'));
        if ($name === '' || $name === '_') $name = 'expense-export';

        return $pdf->download($name . '.pdf');
    }
}
