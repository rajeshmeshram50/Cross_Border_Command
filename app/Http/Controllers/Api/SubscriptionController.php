<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Client;
use App\Models\Payment;
use App\Models\Permission;
use App\Models\Plan;
use App\Models\PlanModule;
use App\Models\Module;
use App\Services\RazorpayService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

class SubscriptionController extends Controller
{
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
        if (!$user->client_id) {
            return response()->json(['has_plan' => false]);
        }

        $client = Client::with('plan')->find($user->client_id);
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
        ]);

        $user = $request->user();
        if (!$user->client_id) {
            return response()->json(['message' => 'Only client admins can subscribe'], 403);
        }

        $plan = Plan::with('modules')->findOrFail($request->plan_id);
        $client = Client::findOrFail($user->client_id);

        [$amount, $gst, $total, $validFrom, $validUntil] = $this->computePricing($plan, $request->billing_cycle);

        // Free plan — activate immediately, no Razorpay
        if ($total <= 0) {
            $payment = $this->createPendingPayment(
                $client, $plan, $user, $amount, $gst, $total,
                $request->billing_cycle, $request->payment_method,
                $validFrom, $validUntil,
                razorpayOrderId: null,
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
    ): Payment {
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
            'gateway_response' => $razorpayOrderId ? ['razorpay_order_id' => $razorpayOrderId] : [],
        ]);
    }

    private function activatePlan(Payment $payment, Plan $plan, Client $client, $user): void
    {
        DB::transaction(function () use ($payment, $plan, $client, $user) {
            $payment->update(['status' => 'success']);

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
        });
    }
}
