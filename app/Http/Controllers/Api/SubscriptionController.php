<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Branch;
use App\Models\Client;
use App\Models\Payment;
use App\Models\Permission;
use App\Models\Plan;
use App\Models\PlanModule;
use App\Models\Module;
use App\Models\User;
use App\Services\InvoiceMailer;
use App\Services\RazorpayService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

class SubscriptionController extends Controller
{
    public function __construct(private InvoiceMailer $invoiceMailer) {}

    public function plans()
    {
        $plans = Plan::where('status', 'active')
            ->with('modules:id,name,slug,icon')
            ->orderBy('sort_order')
            ->get();

        return response()->json($plans);
    }

    public function status(Request $request)
    {
        $user = $request->user();

        /* Same tenant resolution as AuthController::formatUser(). (#206)
         *
         * These two endpoints answer the identical question and must not be
         * able to disagree — the SPA gates on the login/me payload and this one
         * backs the My Plan screen. Both used the raw `users.client_id`, which
         * is unreliable on employee / branch_user rows; for those tiers the
         * branch is the authoritative tenant link.
         *
         * `find()` on a soft-deleted client also returned null here and the
         * next line dereferenced it — a 500 rather than an answer. */
        $client = $user->effectiveClient();
        if (in_array($user->user_type, ['employee', 'branch_user'], true) && $user->branch?->client) {
            $client = $user->branch->client;
        }
        if (!$client) {
            return response()->json(['has_plan' => false]);
        }
        $client->loadMissing('plan');

        $expired = $client->plan_expires_at && $client->plan_expires_at->isPast();

        return response()->json([
            'has_plan' => $client->plan_id !== null && $client->plan_type === 'paid',
            'expired' => $expired,
            'plan' => $client->plan,
            'plan_type' => $client->plan_type,
            'expires_at' => $client->plan_expires_at?->format('Y-m-d'),
        ]);
    }

    /**
     * Step 1 — Create Razorpay order and a pending Payment row.
     * Returns the data the frontend needs to open Razorpay checkout.
     * For free plans (price = 0) the plan is activated directly.
     */
    public function createOrder(Request $request, RazorpayService $razorpay)
    {
        $request->validate([
            'plan_id' => 'required|exists:plans,id',
            'payment_method' => 'required|in:upi,card,net_banking',
            'billing_cycle' => 'required|in:month,quarter,year',
            'kept_branch_ids' => 'nullable|array',
            'kept_branch_ids.*' => 'integer|exists:branches,id',
        ]);

        $user = $request->user();
        if (!$user->client_id) {
            return response()->json(['message' => 'Only client admins can subscribe'], 403);
        }

        $plan = Plan::with('modules')->findOrFail($request->plan_id);
        $client = Client::findOrFail($user->client_id);

        // Branch-shrink guard: if the new plan caps branches below the current
        // active count, the client MUST send `kept_branch_ids` so we know which
        // ones survive. We validate scope (own client, must include main, not
        // exceeding cap) here before any payment is created.
        $keptBranchIds = $this->resolveKeptBranchIds($request, $client, $plan);
        if ($keptBranchIds instanceof \Illuminate\Http\JsonResponse) {
            return $keptBranchIds;
        }

        [$amount, $gst, $total, $validFrom, $validUntil] = $this->computePricing($plan, $request->billing_cycle);

        // Free plan — activate immediately, no Razorpay
        if ($total <= 0) {
            $payment = $this->createPendingPayment(
                $client, $plan, $user, $amount, $gst, $total,
                $request->billing_cycle, $request->payment_method,
                $validFrom, $validUntil,
                razorpayOrderId: null,
                keptBranchIds: $keptBranchIds,
            );

            $this->activatePlan($payment, $plan, $client, $user);

            return response()->json([
                'free' => true,
                'message' => 'Free plan activated',
                'txn_id' => $payment->txn_id,
                'plan' => $plan->name,
                'total' => 0,
                'valid_until' => $validUntil->format('Y-m-d'),
            ]);
        }

        $receipt = 'rcpt_' . now()->format('YmdHis') . '_' . Str::random(6);

        try {
            $order = $razorpay->createOrder($total, $receipt, [
                'client_id' => (string) $client->id,
                'plan_id' => (string) $plan->id,
                'billing_cycle' => $request->billing_cycle,
            ]);
        } catch (\Throwable $e) {
            Log::error('Razorpay order creation failed', ['error' => $e->getMessage()]);
            return response()->json(['message' => 'Could not create payment order. Please try again.'], 502);
        }

        $payment = $this->createPendingPayment(
            $client, $plan, $user, $amount, $gst, $total,
            $request->billing_cycle, $request->payment_method,
            $validFrom, $validUntil,
            razorpayOrderId: $order['id'],
            keptBranchIds: $keptBranchIds,
        );

        return response()->json([
            'free' => false,
            'key' => $razorpay->key(),
            'order_id' => $order['id'],
            'amount' => $order['amount'],
            'currency' => $order['currency'],
            'payment_db_id' => $payment->id,
            'plan_name' => $plan->name,
            'billing_cycle' => $request->billing_cycle,
            'total' => $total,
            'prefill' => [
                'name' => $user->name,
                'email' => $user->email,
                'contact' => $user->phone ?? '',
            ],
            'org_name' => $client->org_name,
        ]);
    }

    /**
     * Step 2b — User cancelled the Razorpay modal OR Razorpay reported failure.
     * Marks the pending Payment as 'failed' so it shows up in the Payments list
     * (otherwise it stays 'pending' forever and "failed payments" never appear).
     */
    public function cancelOrder(Request $request)
    {
        $request->validate([
            'razorpay_order_id' => 'required|string',
            'reason' => 'nullable|string|max:255',
        ]);

        $payment = Payment::where('order_id', $request->razorpay_order_id)->first();
        if (!$payment) {
            return response()->json(['ok' => true]); // no-op if not found
        }

        $user = $request->user();
        if ($payment->client_id !== $user->client_id) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        // Idempotent — never overwrite a finalised state
        if (in_array($payment->status, ['success', 'refunded', 'failed'])) {
            return response()->json(['ok' => true, 'status' => $payment->status]);
        }

        $payment->update([
            'status' => 'failed',
            'gateway_response' => array_merge($payment->gateway_response ?? [], [
                'cancelled_at' => now()->toIso8601String(),
                'cancel_reason' => $request->reason ?? 'user_cancelled',
            ]),
        ]);

        return response()->json(['ok' => true, 'status' => 'failed']);
    }

    /**
     * Step 2 — Verify Razorpay signature, mark Payment success, activate plan.
     */
    public function verifyPayment(Request $request, RazorpayService $razorpay)
    {
        $request->validate([
            'razorpay_order_id' => 'required|string',
            'razorpay_payment_id' => 'required|string',
            'razorpay_signature' => 'required|string',
        ]);

        $payment = Payment::where('order_id', $request->razorpay_order_id)->first();
        if (!$payment) {
            return response()->json(['message' => 'Payment record not found'], 404);
        }

        $user = $request->user();
        if ($payment->client_id !== $user->client_id) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        // Idempotency — already verified by webhook or earlier request
        if ($payment->status === 'success') {
            return response()->json([
                'message' => 'Plan already activated',
                'txn_id' => $payment->txn_id,
                'plan' => $payment->plan->name ?? null,
                'total' => $payment->total,
                'valid_until' => $payment->valid_until?->format('Y-m-d'),
            ]);
        }

        $valid = $razorpay->verifyPaymentSignature(
            $request->razorpay_order_id,
            $request->razorpay_payment_id,
            $request->razorpay_signature,
        );

        if (!$valid) {
            $payment->update([
                'status' => 'failed',
                'gateway_response' => array_merge($payment->gateway_response ?? [], [
                    'verify_error' => 'signature_mismatch',
                    'razorpay_payment_id' => $request->razorpay_payment_id,
                ]),
            ]);
            return response()->json(['message' => 'Payment signature verification failed'], 400);
        }

        $payment->update([
            'txn_id' => $request->razorpay_payment_id,
            'gateway_response' => array_merge($payment->gateway_response ?? [], [
                'razorpay_payment_id' => $request->razorpay_payment_id,
                'razorpay_signature' => $request->razorpay_signature,
                'verified_at' => now()->toIso8601String(),
            ]),
        ]);

        $plan = Plan::with('modules')->findOrFail($payment->plan_id);
        $client = Client::findOrFail($payment->client_id);

        $this->activatePlan($payment, $plan, $client, $user);

        return response()->json([
            'message' => 'Plan activated successfully',
            'txn_id' => $payment->fresh()->txn_id,
            'plan' => $plan->name,
            'total' => $payment->total,
            'valid_until' => $payment->valid_until->format('Y-m-d'),
        ]);
    }

    // ─── Helpers ─────────────────────────────────────────────────────────

    private function computePricing(Plan $plan, string $cycle): array
    {
        $basePrice = (float) $plan->price;
        $multiplier = match ($cycle) {
            'quarter' => 3,
            'year' => 12,
            default => 1,
        };
        $amount = $basePrice * $multiplier;

        if ($cycle === 'year' && $plan->yearly_discount > 0) {
            $amount = $amount * (1 - $plan->yearly_discount / 100);
        }

        $gst = round($amount * 0.18, 2);
        $total = round($amount + $gst, 2);

        $validFrom = now();
        $validUntil = match ($cycle) {
            'quarter' => now()->addMonths(3),
            'year' => now()->addYear(),
            default => now()->addMonth(),
        };

        return [round($amount, 2), $gst, $total, $validFrom, $validUntil];
    }

    private function createPendingPayment(
        Client $client, Plan $plan, $user,
        float $amount, float $gst, float $total,
        string $billingCycle, string $paymentMethod,
        $validFrom, $validUntil,
        ?string $razorpayOrderId,
        ?array $keptBranchIds = null,
    ): Payment {
        $gatewayResponse = $razorpayOrderId ? ['razorpay_order_id' => $razorpayOrderId] : [];
        if (!empty($keptBranchIds)) {
            $gatewayResponse['kept_branch_ids'] = array_values($keptBranchIds);
        }

        return Payment::create([
            'client_id' => $client->id,
            'plan_id' => $plan->id,
            'txn_id' => 'PENDING-' . strtoupper(Str::random(10)),
            'order_id' => $razorpayOrderId ?? ('FREE-' . now()->format('Ymd') . '-' . strtoupper(Str::random(6))),
            'amount' => $amount,
            'gst' => $gst,
            'discount' => 0,
            'total' => $total,
            'currency' => 'INR',
            'method' => $paymentMethod,
            'gateway' => 'razorpay',
            'billing_cycle' => $billingCycle,
            'valid_from' => $validFrom,
            'valid_until' => $validUntil,
            'auto_renew' => false,
            'status' => $total <= 0 ? 'success' : 'pending',
            'invoice_number' => 'INV-' . now()->format('Ymd') . '-' . strtoupper(Str::random(4)),
            'processed_by' => $user->id,
            'gateway_response' => $gatewayResponse,
        ]);
    }

    private function activatePlan(Payment $payment, Plan $plan, Client $client, $user): void
    {
        DB::transaction(function () use ($payment, $plan, $client, $user) {
            $payment->update(['status' => 'success']);
            // Mail dispatch deferred to AFTER the DB transaction commits — see
            // the post-transaction call below. Doing it inside the transaction
            // would risk emailing an invoice for state that later rolls back.

            $client->update([
                'plan_id' => $plan->id,
                'plan_type' => 'paid',
                'status' => 'active',
                'plan_expires_at' => $payment->valid_until,
            ]);

            // Reset and grant module permissions for this client admin
            Permission::where('user_id', $user->id)->delete();

            $planModules = PlanModule::where('plan_id', $plan->id)->get();
            $allModules = Module::where('is_active', true)->get();

            foreach ($allModules as $mod) {
                $planMod = $planModules->firstWhere('module_id', $mod->id);
                $isIncluded = $planMod && in_array($planMod->access_level, ['full', 'limited']);
                $isFull = $planMod && $planMod->access_level === 'full';

                if ($isIncluded || $mod->is_default) {
                    DB::table('permissions')->insert([
                        'user_id' => $user->id,
                        'client_id' => $client->id,
                        'branch_id' => $user->branch_id,
                        'role' => 'client_admin',
                        'module_id' => $mod->id,
                        'can_view' => true,
                        'can_add' => $isFull || $mod->is_default,
                        'can_edit' => $isFull || $mod->is_default,
                        'can_delete' => $isFull,
                        'can_export' => $isFull,
                        'can_import' => $isFull,
                        'can_approve' => $isFull,
                        'granted_by' => $user->id,
                        'created_at' => now(),
                        'updated_at' => now(),
                    ]);
                }
            }

            // Downgrade hygiene — without these two steps, a client who shrinks
            // their plan keeps every old branch active and every old branch-user
            // permission. Both must be reconciled to the new plan's footprint.
            $this->cascadePruneDownstreamPermissions($user->id, $client->id);
            $this->enforceBranchLimit($client, $plan, $payment);
        });

        // Send invoice mail AFTER the activation transaction commits — the
        // service swallows its own failures so a transient SMTP/PDF problem
        // can't reverse a payment we already confirmed with the gateway.
        $this->invoiceMailer->sendForPayment($payment->fresh());
    }

    /**
     * Drop any flag a branch_user / employee still holds that the freshly-reset
     * client admin no longer has post-downgrade. Mirrors PermissionController's
     * cascade — duplicated here because the trigger (plan change) is different
     * from the manual super-admin save path. Returns rows touched.
     */
    private function cascadePruneDownstreamPermissions(int $adminUserId, int $clientId): int
    {
        $fields = ['can_view', 'can_add', 'can_edit', 'can_delete', 'can_export', 'can_import', 'can_approve'];

        $adminPerms = DB::table('permissions')
            ->where('user_id', $adminUserId)
            ->get(['module_id', ...$fields])
            ->keyBy('module_id');

        $downstreamUserIds = User::where('client_id', $clientId)
            ->whereIn('user_type', ['branch_user', 'employee'])
            ->pluck('id');

        $affected = 0;
        foreach ($downstreamUserIds as $duid) {
            $rows = DB::table('permissions')->where('user_id', $duid)->get();
            foreach ($rows as $row) {
                $admin = $adminPerms->get($row->module_id);

                // Whole module not in admin's perms anymore → wipe row entirely
                if (!$admin) {
                    DB::table('permissions')->where('id', $row->id)->delete();
                    $affected++;
                    continue;
                }

                $updates = [];
                foreach ($fields as $f) {
                    if ($row->$f && !$admin->$f) {
                        $updates[$f] = false;
                    }
                }
                if (!empty($updates)) {
                    $updates['updated_at'] = now();
                    DB::table('permissions')->where('id', $row->id)->update($updates);
                    $affected++;
                }

                $stillHasAny = collect($fields)
                    ->some(fn($f) => array_key_exists($f, $updates) ? $updates[$f] : $row->$f);
                if (!$stillHasAny) {
                    DB::table('permissions')->where('id', $row->id)->delete();
                }
            }
        }
        return $affected;
    }

    /**
     * Enforce plan.max_branches by deactivating any branch the client did NOT
     * include in `kept_branch_ids` on the order. Branches are NOT soft-deleted
     * — they go status='inactive' so re-upgrading restores them. Sanctum tokens
     * for users in deactivated branches are revoked so live sessions die.
     *
     * Fallback (no kept_branch_ids on the payment): keep main + oldest N-1 by
     * created_at. This handles renewals/upgrades where no shrink is needed.
     */
    private function enforceBranchLimit(Client $client, Plan $plan, Payment $payment): int
    {
        $maxBranches = (int) ($plan->max_branches ?? 0);
        if ($maxBranches <= 0) {
            return 0;
        }

        $keptIds = collect($payment->gateway_response['kept_branch_ids'] ?? [])
            ->map(fn($id) => (int) $id)
            ->filter()
            ->values()
            ->all();

        $activeBranches = Branch::where('client_id', $client->id)
            ->where('status', 'active')
            ->orderBy('created_at')
            ->get(['id', 'status', 'created_at']);

        if ($activeBranches->count() <= $maxBranches) {
            return 0;
        }

        if (!empty($keptIds)) {
            // Validate: client-scoped kept set, capped to max_branches
            $validKeptIds = $activeBranches->pluck('id')
                ->intersect($keptIds)
                ->take($maxBranches)
                ->values()
                ->all();

            $excess = $activeBranches->whereNotIn('id', $validKeptIds);
        } else {
            // No selection submitted — keep the oldest branches
            $excess = $activeBranches->slice($maxBranches);
        }

        if ($excess->isEmpty()) {
            return 0;
        }

        $excessIds = $excess->pluck('id')->all();

        Branch::whereIn('id', $excessIds)->update(['status' => 'inactive']);

        $userIds = User::whereIn('branch_id', $excessIds)->pluck('id');
        if ($userIds->isNotEmpty()) {
            DB::table('personal_access_tokens')
                ->where('tokenable_type', User::class)
                ->whereIn('tokenable_id', $userIds)
                ->delete();
        }

        return count($excessIds);
    }

    /**
     * Validate the `kept_branch_ids` payload against the new plan and the
     * caller's own client. Returns the cleaned id list, or a JsonResponse
     * the controller can return as-is on validation failure.
     *
     * Required only when current active branch count > new plan's max_branches.
     * If not required, an empty array is returned — `enforceBranchLimit` will
     * fall through to the no-op path.
     */
    private function resolveKeptBranchIds(Request $request, Client $client, Plan $plan)
    {
        $maxBranches = (int) ($plan->max_branches ?? 0);
        if ($maxBranches <= 0) {
            return []; // unlimited plan — selection is meaningless
        }

        $clientBranches = Branch::where('client_id', $client->id)
            ->where('status', 'active')
            ->get(['id']);

        $currentCount = $clientBranches->count();
        $shrinkRequired = $currentCount > $maxBranches;

        $submitted = collect($request->input('kept_branch_ids', []))
            ->map(fn($id) => (int) $id)
            ->filter()
            ->unique()
            ->values();

        if (!$shrinkRequired) {
            // Selection allowed but ignored — frontend may still submit it.
            // Filter to the client's own branches just to be safe.
            return $clientBranches->pluck('id')->intersect($submitted)->values()->all();
        }

        if ($submitted->isEmpty()) {
            return response()->json([
                'message' => "This plan allows up to {$maxBranches} branches but you currently have {$currentCount}. Select which branches to keep before downgrading.",
                'requires_branch_selection' => true,
                'max_branches' => $maxBranches,
                'current_branch_count' => $currentCount,
            ], 422);
        }

        $clientBranchIds = $clientBranches->pluck('id')->all();
        $foreign = $submitted->reject(fn($id) => in_array($id, $clientBranchIds, true));
        if ($foreign->isNotEmpty()) {
            return response()->json([
                'message' => 'Selected branches must belong to your organization.',
            ], 422);
        }

        if ($submitted->count() > $maxBranches) {
            return response()->json([
                'message' => "You can keep at most {$maxBranches} branches on this plan.",
                'max_branches' => $maxBranches,
            ], 422);
        }

        return array_values(array_unique(array_map('intval', $submitted->all())));
    }
}
