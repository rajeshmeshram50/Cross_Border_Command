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
                'employee' => fn ($r) => $r->withTrashed()
                    ->select('id', 'first_name', 'middle_name', 'last_name', 'display_name', 'emp_code', 'reporting_manager_id', 'reporting_manager_user_id', 'department_id'),
                'employee.department:id,name',
                'employee.reportingManagerUser:id,name',
                'manager' => fn ($r) => $r->withTrashed()
                    ->select('id', 'first_name', 'middle_name', 'last_name', 'display_name', 'emp_code'),
                'category:id,name,code',
                'creator:id,name,user_type',
                'hrUser:id,name,user_type',
                'reimbursedAdvance:id,advance_no,settle_reimbursement_claim_id',
                'managerActor:id,name',
                'payments' => fn ($r) => $r->with('payer:id,name'),
            ])
            ->orderByDesc('id');

        $this->applyTenantScope($q, $user, $request->integer('branch_id') ?: null);

        if ($scope === 'mine') {
            $myEmployeeId = $this->currentEmployeeId($user);
            $targetEmployeeId = $myEmployeeId;
            if ($employeeIdFilter && $employeeIdFilter !== $myEmployeeId) {
                $targetEmployeeId = $this->mayReadEmployeeClaims($user, $employeeIdFilter, $myEmployeeId)
                    ? $employeeIdFilter
                    : -1;
            }
            $q->where('employee_id', $targetEmployeeId ?? -1);
        } elseif ($scope === 'team') {
            if (in_array($user->user_type, ['super_admin', 'client_admin', 'branch_user'], true)) {
                $myEmployeeId = $this->currentEmployeeId($user);
                if ($myEmployeeId) {
                    $q->where('employee_id', '!=', $myEmployeeId);
                }
            } else {
                $myEmployeeId = $this->currentEmployeeId($user);
                $teamIds = $this->downstreamEmployeeIds($myEmployeeId);
                $managedOthers = $myEmployeeId && ExpenseClaim::where('manager_id', $myEmployeeId)
                    ->where('employee_id', '!=', $myEmployeeId)
                    ->exists();
                if (!$teamIds && !$managedOthers) {
                    return response()->json([]);
                }
                $teamIds = array_values(array_unique($teamIds)) ?: [-1];
                $q->where(function ($w) use ($teamIds, $myEmployeeId) {
                    $w->whereIn('employee_id', $teamIds);
                    if ($myEmployeeId) {
                        $w->orWhere('manager_id', $myEmployeeId);
                    }
                });
                if ($myEmployeeId) {
                    $q->where('employee_id', '!=', $myEmployeeId);
                }
            }
        } else {
            $this->guardHrPermission($user, 'can_view');
            if ($employeeIdFilter) {
                $q->where('employee_id', $employeeIdFilter);
            }
        }

        $from = $request->query('date_from');
        $to   = $request->query('date_to');
        if ($from) $q->whereDate('expense_date', '>=', $from);
        if ($to)   $q->whereDate('expense_date', '<=', $to);

        $base = clone $q;

        if ($status = $request->query('status')) {
            if (in_array($status, self::STATUSES, true)) {
                $q->where('status', $status);
            }
        }

        if ($term = trim((string) $request->query('q', ''))) {
            $like = '%' . str_replace(['\\', '%', '_'], ['\\\\', '\%', '\_'], mb_strtolower($term)) . '%';
            $q->where(function ($w) use ($like) {
                foreach (['claim_no', 'employee_name', 'category_name', 'title', 'vendor', 'purpose'] as $col) {
                    $w->orWhereRaw("LOWER(COALESCE($col, '')) LIKE ?", [$like]);
                }
                $w->orWhereHas('employee', function ($e) use ($like) {
                    $e->withTrashed()->where(function ($x) use ($like) {
                        foreach (['emp_code', 'first_name', 'middle_name', 'last_name', 'display_name'] as $col) {
                            $x->orWhereRaw("LOWER(COALESCE($col, '')) LIKE ?", [$like]);
                        }
                        $x->orWhereHas('department', fn ($d) => $d->whereRaw("LOWER(COALESCE(name, '')) LIKE ?", [$like]));
                    });
                });
            });
        }

        if ($request->filled('page') || $request->filled('per_page')) {
            $perPage = (int) $request->query('per_page', 0);
            $perPage = max(1, min(200, $perPage ?: 25));
            $page    = max(1, (int) $request->query('page', 1));

            $p = $q->paginate($perPage, ['*'], 'page', $page);

            return response()->json([
                'data'    => collect($p->items())->map(fn ($r) => $this->serialize($r))->values(),
                'meta'    => [
                    'page'      => $p->currentPage(),
                    'per_page'  => $p->perPage(),
                    'total'     => $p->total(),
                    'last_page' => $p->lastPage(),
                ],
                'summary' => $this->claimsSummary($base),
            ]);
        }

        return response()->json($q->get()->map(fn ($r) => $this->serialize($r)));
    }

    private function claimsSummary($base): array
    {
        $agg = (clone $base)->reorder()->selectRaw("
            COUNT(*)                                                       AS c_all,
            COUNT(*) FILTER (WHERE status = 'pending')                     AS c_pending,
            COUNT(*) FILTER (WHERE status = 'approved')                    AS c_approved,
            COUNT(*) FILTER (WHERE status = 'rejected')                    AS c_rejected,
            COALESCE(SUM(amount) FILTER (WHERE status <> 'rejected'), 0)   AS total_amount,
            COALESCE(SUM(amount) FILTER (WHERE status = 'approved'), 0)    AS approved_amount
        ")->first();

        $cats = (clone $base)->reorder()
            ->where('status', 'approved')
            ->selectRaw("category_id, COALESCE(category_name, '—') AS category_name, SUM(amount) AS spent")
            ->groupBy('category_id', 'category_name')
            ->havingRaw('SUM(amount) > 0')
            ->get()
            ->map(fn ($r) => [
                'id'    => $r->category_id !== null ? (int) $r->category_id : null,
                'name'  => (string) $r->category_name,
                'spent' => (float) $r->spent,
            ])->values();

        return [
            'counts' => [
                'all'      => (int) ($agg->c_all ?? 0),
                'pending'  => (int) ($agg->c_pending ?? 0),
                'approved' => (int) ($agg->c_approved ?? 0),
                'rejected' => (int) ($agg->c_rejected ?? 0),
            ],
            'total_amount'    => (float) ($agg->total_amount ?? 0),
            'approved_amount' => (float) ($agg->approved_amount ?? 0),
            'categories'      => $cats,
        ];
    }

    public function store(Request $request)
    {
        $user = $request->user();
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
        if ($user->user_type !== 'super_admin'
            && $employee->user_id !== $user->id) {
            abort(403, 'You can only file claims for your own employee record.');
        }

        OnboardingGuard::assertComplete(
            $employee,
            'raise an expense claim',
            (int) ($employee->user_id ?? 0) === (int) $user->id,
        );

        if ($employee->date_of_joining
            && $employee->date_of_joining->toDateString() > now()->toDateString()) {
            return response()->json([
                'message' => 'You cannot raise an expense claim before your joining date ('
                    . $employee->date_of_joining->format('d M Y') . ').',
                'errors'  => ['employee_id' => ['Joining date is in the future.']],
            ], 422);
        }

        $minExpenseDate = now()->subDays(30)->toDateString();

        if ($request->has('purpose')) {
            $request->merge(['purpose' => str_replace("\r\n", "\n", (string) $request->input('purpose'))]);
        }

        $data = $request->validate([
            'category_id'    => ['nullable', 'integer'],
            'currency'       => ['nullable', 'string', 'max:8'],
            'project'        => ['nullable', 'string', 'max:64'],
            'payment_method' => ['required', 'string', 'max:64'],
            'title'          => ['required', 'string', 'max:255'],
            'amount'         => ['required', 'numeric', 'min:0', 'max:9999999999999.99'],
            'expense_date'   => ['required', 'date', 'before_or_equal:today', 'after_or_equal:' . $minExpenseDate],
            'vendor'         => ['nullable', 'string', 'max:255'],
            'purpose'        => ['nullable', 'string', 'max:500'],
            'files'          => ['required', 'array', 'min:1'],
            'files.*'        => ['file', 'max:2048', 'mimes:pdf,jpg,jpeg,png'],
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

        $totalBytes = collect((array) $request->file('files', []))
            ->filter()
            ->sum(fn ($f) => (int) $f->getSize());
        if ($totalBytes > 5 * 1024 * 1024) {
            throw \Illuminate\Validation\ValidationException::withMessages([
                'files' => ['Attachments total ' . round($totalBytes / 1048576, 1) . ' MB — keep the claim under 5 MB.'],
            ]);
        }

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
        }

        $reimbAdvance = null;
        if (!empty($data['reimbursement_for_advance_id'])) {
            $reimbAdvance = \App\Models\AdvanceRequest::find($data['reimbursement_for_advance_id']);
            $valid = $reimbAdvance
                && $reimbAdvance->employee_id === $employee->id
                && $reimbAdvance->employee_settled_at
                && $reimbAdvance->settle_type === 'reimburse'
                && !$reimbAdvance->settle_reimbursement_claim_id;
            if (!$valid) {
                $reimbAdvance = null;
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

        $managerStatus   = 'pending';
        $managerActedAt  = null;
        $managerComment  = null;

        $row = DB::transaction(function () use ($employee, $data, $attachments, $categoryName, $managerStatus, $managerActedAt, $managerComment, $user) {
            return ExpenseClaim::create([
                'client_id'        => $employee->client_id,
                'branch_id'        => $employee->branch_id,
                'claim_no'         => $this->nextClaimNo($employee->client_id, $employee->branch_id),
                'employee_id'      => $employee->id,
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

        if ($reimbAdvance && !$reimbAdvance->settle_reimbursement_claim_id) {
            $reimbAdvance->settle_reimbursement_claim_id = $row->id;
            $reimbAdvance->settle_reimbursed_at = now();
            $reimbAdvance->save();
        }

        $row->load(['employee.department', 'manager', 'category', 'creator', 'hrUser', 'reimbursedAdvance:id,advance_no,settle_reimbursement_claim_id']);
        return response()->json($this->serialize($row), 201);
    }

    public function show(Request $request, $id)
    {
        $user = $request->user();
        $row = ExpenseClaim::with([
                'employee' => fn ($r) => $r->withTrashed(),
                'manager' => fn ($r) => $r->withTrashed(),
                'category', 'creator', 'hrUser',
            ])
            ->findOrFail($id);
        $this->ensureTenantAccess($row, $user);
        return response()->json($this->serialize($row));
    }

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

        $zoho = app(\App\Services\ZohoBooksService::class);
        if (!$zoho->isConfigured()) {
            return response()->json(['status' => false, 'message' => 'Zoho Books is not configured on the server.'], 503);
        }

        $title    = ($claim->claim_no ?: ('EXP-' . $claim->id)) . ' - ' . ($claim->title ?: 'Expense');
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
                'product_type'           => strtolower($payment->expense_type ?: 'goods') === 'service' ? 'service' : 'goods',
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

                $receiptFiles = [];
                if (!empty($payment->proof_path)) {
                    $receiptFiles[] = [
                        'path' => $payment->proof_path,
                        'name' => $payment->proof_name ?: basename($payment->proof_path),
                    ];
                }
                foreach (($claim->attachments ?? []) as $att) {
                    $p = is_array($att) ? ($att['path'] ?? null) : null;
                    if (empty($p)) continue;
                    $receiptFiles[] = [
                        'path' => $p,
                        'name' => (is_array($att) ? ($att['name'] ?? null) : null) ?: basename($p),
                    ];
                }
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

    private function expNo(ExpenseClaim $c): string
    {
        return $c->claim_no ?: ('EXP-' . str_pad((string) $c->id, 4, '0', STR_PAD_LEFT));
    }

    public function batchPayable(Request $request)
    {
        $user = $request->user();
        $this->guardHrPermission($user, 'can_approve');
        $employeeId = $this->resolveEmployeeId($request->query('employee_id'), $request->query('employee_code'), $user);
        if (!$employeeId) {
            return response()->json(['data' => []]);
        }
        $q = ExpenseClaim::query()
            ->with(['category:id,name'])
            ->where('employee_id', $employeeId)
            ->whereIn('status', ['approved', 'pending'])
            ->where(fn ($w) => $w->whereNull('settlement_status')->orWhere('settlement_status', '!=', 'paid'));
        $this->applyTenantScope($q, $user, $request->integer('branch_id') ?: null);

        return response()->json([
            'data' => $q->orderBy('id')->get()->map(function ($c) {
                $payableBase = (float) ($c->sanctioned_amount ?? $c->amount);
                $remaining   = round($payableBase - (float) $c->total_paid, 2);
                return [
                'id'            => $c->id,
                'exp_no'        => $this->expNo($c),
                'title'         => $c->title,
                'category_id'   => $c->category_id,
                'category_name' => $c->category?->name ?? $c->category_name,
                'expense_date'  => optional($c->expense_date)->format('Y-m-d'),
                'amount'        => max(0, $remaining),
                'claim_amount'  => $payableBase,
                'paid'          => (float) $c->total_paid,
                'note'          => $c->purpose ?: $c->title,
                'attachments'   => collect($c->attachments ?? [])->count(),
                'status'        => $c->status,
                'payable'       => $c->status === 'approved',
                'manager_status' => $c->manager_status,
                'hr_status'      => $c->hr_status,
                'pending_stage'  => $c->status === 'approved'
                    ? null
                    : (($c->manager_status ?? 'pending') !== 'approved' ? 'manager' : 'hr'),
                ];
            })->values(),
        ]);
    }

    public function batchPayments(Request $request)
    {
        $user = $request->user();
        $this->guardHrPermission($user, 'can_view');
        $q = \App\Models\ExpenseBatchPayment::query()->with(['employee:id,first_name,last_name,display_name,emp_code', 'payments:id,batch_payment_id,expense_claim_id']);
        $this->applyTenantScope($q, $user, $request->integer('branch_id') ?: null);

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
        $zoho = app(\App\Services\ZohoBooksService::class);
        if (!$zoho->isConfigured()) {
            return response()->json(['status' => false, 'message' => 'Zoho Books is not configured.'], 422);
        }

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

        $remainingOf = fn ($c) => round((float) ($c->sanctioned_amount ?? $c->amount) - (float) $c->total_paid, 2);
        $total = round($claims->sum($remainingOf), 2);

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
                $amt = $remainingOf($c);
                if ($amt <= 0) continue;
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
                if ($c->sanctioned_amount === null) $c->sanctioned_amount = (float) $c->amount;
                $c->total_paid = round((float) $c->total_paid + $amt, 2);
                $c->settlement_status = 'paid';
                $c->settled_at = now();
                $c->save();
            }
            return $batch;
        });

        return response()->json([
            'status'  => true,
            'message' => 'Batch payment recorded — ' . $claims->count() . ' claim(s), ₹' . number_format($total, 2) . ' paid. Use “Zoho Sync” to push it to Zoho Books.',
            'batch_id'=> $batch->id,
        ]);
    }

    private function syncBatchToZoho(\App\Models\ExpenseBatchPayment $batch, $claims, string $expenseType): void
    {
        $zoho = app(\App\Services\ZohoBooksService::class);
        if (!$zoho->isConfigured()) {
            return;
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
        if ($user->user_type !== 'super_admin' && $myEmployeeId !== null && (int) $row->employee_id === (int) $myEmployeeId) {
            abort(403, 'You cannot approve your own expense claim — your reporting manager (branch user) will approve it.');
        }
        $isAssignedManager = $myEmployeeId !== null && (int) $row->manager_id === (int) $myEmployeeId;
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

        $data = $request->validate([
            'comment' => [$verdict === 'rejected' ? 'required' : 'nullable', 'string', 'max:1000'],
        ], [
            'comment.required' => 'A reason is required to reject this claim.',
        ]);

        $row->manager_status   = $verdict;
        $row->manager_acted_at = now();
        $row->manager_acted_by = $user->id;
        $row->manager_comment  = $data['comment'] ?? null;
        if ($verdict === 'rejected') {
            $row->status = 'rejected';
        }
        $row->save();

        $row->load(['employee.department', 'manager', 'category', 'creator', 'hrUser']);
        return response()->json($this->serialize($row));
    }

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
            $row->status      = $verdict;
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

    private function currentEmployeeId($user): ?int
    {
        if (!$user) return null;
        return $user->employee_id;
    }

    private array $hrExpenseView = [];

    private function hasHrExpenseView($user): bool
    {
        if (!$user) return false;
        $uid = (int) $user->id;
        if (array_key_exists($uid, $this->hrExpenseView)) return $this->hrExpenseView[$uid];

        $moduleId = Module::where('slug', 'hr.expense')->value('id');
        if (!$moduleId) {
            return $this->hrExpenseView[$uid] = false;
        }

        return $this->hrExpenseView[$uid] = Permission::where('user_id', $user->id)
            ->where('module_id', $moduleId)
            ->where('can_view', true)
            ->exists();
    }

    private function mayReadEmployeeClaims($user, int $targetEmployeeId, ?int $myEmployeeId): bool
    {
        if (!$user) return false;
        if ($user->user_type === 'super_admin') return true;

        $target = Employee::withTrashed()
            ->select('id', 'client_id', 'branch_id')
            ->find($targetEmployeeId);
        if (!$target) return false;
        if ($target->client_id !== null && (int) $target->client_id !== (int) $user->client_id) {
            return false;
        }

        if (in_array($user->user_type, ['client_admin', 'client_user'], true)) {
            return true;
        }
        if ($user->user_type === 'branch_user') {
            return $target->branch_id === null
                || (int) $target->branch_id === (int) $user->branch_id;
        }

        if (in_array($targetEmployeeId, $this->downstreamEmployeeIds($myEmployeeId), true)) {
            return true;
        }
        if ($this->hasHrExpenseView($user)) {
            return $target->branch_id === null
                || $user->branch_id === null
                || (int) $target->branch_id === (int) $user->branch_id;
        }
        return false;
    }

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

    private function resolveEmployeeId($idInput, $codeInput, $user = null): ?int
    {
        if ($idInput !== null && $idInput !== '') {
            if (is_numeric($idInput)) {
                return (int) $idInput;
            }
            $codeInput = $codeInput ?: $idInput;
        }
        if ($codeInput) {
            $q = Employee::where('emp_code', $codeInput);
            if ($user && $user->user_type !== 'super_admin' && $user->client_id) {
                $q->where('client_id', $user->client_id);
            }
            $found = $q->value('id');
            if ($found) return (int) $found;
        }
        return null;
    }

    private function guardHrPermission($user, string $perm): void
    {
        if (!$user) abort(401, 'Authentication required');
        if ($user->user_type === 'super_admin') return;

        $moduleId = Module::where('slug', 'hr.expense')->value('id');
        if (!$moduleId) {
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
            if ($row->client_id !== null && $row->client_id !== $user->client_id) {
                abort(403, 'Out of tenant scope.');
            }
            if ($row->branch_id !== null) {
                $allowed = $row->branch_id === $user->branch_id;
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

    private function applySwitcherBranchFilter($q, $user, ?int $branchFilter): void
    {
        if ($branchFilter === null) return;
        $belongsToClient = Branch::where('id', $branchFilter)
            ->where('client_id', $user->client_id)
            ->exists();
        if (!$belongsToClient) return;
        $q->where('branch_id', $branchFilter);
    }

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

    private function serialize(ExpenseClaim $row): array
    {
        $employee = $row->employee;
        $manager  = $row->manager;
        $employeeName = ($employee
            ? ($employee->display_name
                ?: trim(($employee->first_name ?? '') . ' ' . ($employee->last_name ?? '')))
            : null) ?: $row->employee_name;
        $managerName = $manager
            ? ($manager->display_name
                ?: trim(($manager->first_name ?? '') . ' ' . ($manager->last_name ?? '')))
            : null;
        if (!$managerName && $employee && $employee->reporting_manager_user_id) {
            $managerName = $employee->relationLoaded('reportingManagerUser')
                ? $employee->reportingManagerUser?->name
                : \App\Models\User::whereKey($employee->reporting_manager_user_id)->value('name');
        }
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
            'reporting_manager_user_id' => $employee?->reporting_manager_user_id,
            'manager_name'    => $managerName,
            'category_id'     => $row->category_id,
            'category_name'   => $row->category?->name ?? $row->category_name,
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
            'sanctioned_amount' => $row->sanctioned_amount !== null ? (float) $row->sanctioned_amount : null,
            'deduction_amount'  => (float) $row->deduction_amount,
            'deduction_reason'  => $row->deduction_reason,
            'total_paid'        => (float) $row->total_paid,
            'settlement_status' => $row->settlement_status ?: 'unpaid',
            'settled_at'        => optional($row->settled_at)->toIso8601String(),
            'reimbursement_emailed_at' => optional($row->reimbursement_emailed_at)->toIso8601String(),
            'zoho_all_synced'   => (function () use ($row) {
                $payments = $row->relationLoaded('payments') ? $row->payments : $row->payments()->get();
                return $payments->isNotEmpty() && $payments->every(fn ($p) => ($p->zoho_status ?? 'not_synced') === 'synced');
            })(),
            'zoho_sync'         => (function () use ($row) {
                $payments = $row->relationLoaded('payments') ? $row->payments : $row->payments()->get();
                if ($payments->isEmpty()) return 'na';
                $synced = $payments->filter(fn ($p) => ($p->zoho_status ?? 'not_synced') === 'synced')->count();
                if ($synced === 0) return 'pending';
                return $synced === $payments->count() ? 'completed' : 'partial';
            })(),
            'remaining_amount'  => $row->sanctioned_amount !== null
                ? round((float) $row->sanctioned_amount - (float) $row->total_paid, 2)
                : null,
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

    public function settlement(Request $request, $id)
    {
        $user = $request->user();
        $row  = ExpenseClaim::with(['payments.payer', 'payments.category', 'employee', 'category'])->findOrFail($id);
        $this->ensureTenantAccess($row, $user);

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
            'attachments'       => collect($row->attachments ?? [])->values()->map(fn ($a, $i) => [
                'name' => $a['name'] ?? ('Attachment ' . ($i + 1)),
                'size' => $a['size'] ?? null,
                'url'  => url("/api/expense-claims/{$row->id}/attachments/{$i}"),
            ])->all(),
            'payments'          => $row->payments->map(fn ($p) => [
                'id'           => $p->id,
                'amount'       => (float) $p->amount,
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

    public function settle(Request $request, $id)
    {
        $user = $request->user();
        $row  = ExpenseClaim::findOrFail($id);
        $this->ensureTenantAccess($row, $user);
        $this->guardHrPermission($user, 'can_approve');
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
            'deductions'          => ['nullable', 'array'],
            'deductions.*.amount' => ['required_with:deductions', 'numeric', 'min:0'],
            'deductions.*.reason' => ['nullable', 'string', 'max:500'],
            'additions'           => ['nullable', 'array'],
            'additions.*.amount'  => ['required_with:additions', 'numeric', 'min:0', 'max:100000'],
            'additions.*.reason'  => ['nullable', 'string', 'max:500'],
            'amount'              => ['required', 'numeric', 'min:0.01'],
            'category_id'         => ['required', 'integer'],
            'payment_type'        => ['required', 'string', 'in:Cheque,UPI,PhonePe,Bank Transfer'],
            'expense_type'        => ['required', 'string', 'in:Goods,Service'],
            'note'                => ['required', 'string', 'max:500'],
            'proof'               => ['required', 'file', 'max:2048', 'mimes:pdf,jpg,jpeg,png'],
        ], [
            'proof.max'      => 'Proof of payment must be 2 MB or smaller.',
            'proof.uploaded' => 'Proof of payment must be 2 MB or smaller.',
            'proof.mimes'    => 'Proof of payment must be a PDF, JPG, JPEG or PNG file.',
        ]);

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

        $categoryId   = $data['category_id'] ?? $row->category_id;
        $categoryName = $row->category_name;
        if (!empty($data['category_id'])) {
            $cat = \App\Models\Masters\ExpenseCategories::find($data['category_id']);
            if ($cat) $categoryName = $cat->name;
        }

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

    public function exportPdf(Request $request)
    {
        $data = $request->validate([
            'title'     => ['required', 'string', 'max:200'],
            'meta'      => ['nullable', 'string', 'max:300'],
            'filename'  => ['nullable', 'string', 'max:120'],
            'headers'   => ['required', 'array', 'min:1', 'max:40'],
            'headers.*' => ['nullable', 'string', 'max:120'],
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

        $name = preg_replace('/[^A-Za-z0-9._-]+/', '_', (string) ($data['filename'] ?? 'expense-export'));
        if ($name === '' || $name === '_') $name = 'expense-export';

        return $pdf->download($name . '.pdf');
    }
}
