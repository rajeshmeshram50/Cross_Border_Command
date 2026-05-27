<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Client;
use App\Models\Payment;
use App\Models\Plan;
use App\Models\Module;
use App\Models\PlanModule;
use App\Models\Permission;
use App\Models\User;
use App\Services\InvoiceMailer;
use App\Services\RazorpayService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class RazorpayWebhookController extends Controller
{
    public function __construct(private InvoiceMailer $invoiceMailer) {}

    public function handle(Request $request, RazorpayService $razorpay)
    {
        $signature = $request->header('X-Razorpay-Signature', '');
        $payload = $request->getContent();

        if (!$razorpay->verifyWebhookSignature($payload, $signature)) {
            Log::warning('Razorpay webhook signature mismatch');
            return response()->json(['message' => 'Invalid signature'], 400);
        }

        $event = $request->input('event');
        $paymentEntity = $request->input('payload.payment.entity');
        $orderId = $paymentEntity['order_id'] ?? null;

        if (!$orderId) {
            return response()->json(['ok' => true]);
        }

        // Lock the Payment row for the duration of this handler so two
        // concurrent webhook deliveries for the same order can't both pass
        // the "not yet success" check and both call activateFromWebhook().
        // Razorpay's at-least-once delivery makes concurrent retries a real
        // possibility, not a theoretical one.
        $payment = DB::transaction(function () use ($orderId, $event, $paymentEntity) {
            $p = Payment::where('order_id', $orderId)->lockForUpdate()->first();
            if (!$p) return null;

            // Idempotent — only act if status hasn't been finalised.
            if (in_array($p->status, ['success', 'refunded'], true)) {
                return $p;
            }

            // Amount-tampering defence: the webhook signature already proves
            // the payload came from Razorpay, but a fraudulent caller could
            // still target an order whose `total` doesn't match what was
            // actually captured (e.g. someone replays a low-tier webhook
            // against a high-tier order_id from a parallel flow). Razorpay
            // amounts are in paise; our `total` is in rupees. Reject any
            // mismatch and force a manual reconcile.
            if (in_array($event, ['payment.captured', 'order.paid'], true)) {
                $capturedPaise = (int) ($paymentEntity['amount'] ?? 0);
                $expectedPaise = (int) round(((float) $p->total) * 100);
                if ($capturedPaise !== $expectedPaise) {
                    Log::warning('Razorpay webhook amount mismatch — refusing to activate', [
                        'order_id'        => $p->order_id,
                        'expected_paise'  => $expectedPaise,
                        'captured_paise'  => $capturedPaise,
                        'event'           => $event,
                    ]);
                    return false;  // sentinel: caller returns 200 to ack but skips activation
                }
            }
            return $p;
        });

        if ($payment === null) {
            Log::info('Razorpay webhook for unknown order', ['order_id' => $orderId, 'event' => $event]);
            return response()->json(['ok' => true]);
        }
        if ($payment === false) {
            // Amount mismatch already logged. Ack with 200 so Razorpay stops
            // retrying — investigation happens via the Log entry above.
            return response()->json(['ok' => true, 'note' => 'amount mismatch']);
        }
        if (in_array($payment->status, ['success', 'refunded'], true)) {
            return response()->json(['ok' => true]);
        }

        if ($event === 'payment.captured' || $event === 'order.paid') {
            $payment->update([
                'txn_id' => $paymentEntity['id'] ?? $payment->txn_id,
                'method' => $paymentEntity['method'] ?? $payment->method,
                'gateway_response' => array_merge($payment->gateway_response ?? [], [
                    'webhook_event' => $event,
                    'webhook_received_at' => now()->toIso8601String(),
                    'payment_entity' => $paymentEntity,
                ]),
            ]);

            $plan = Plan::with('modules')->find($payment->plan_id);
            $client = Client::find($payment->client_id);
            $user = User::find($payment->processed_by);

            if ($plan && $client && $user) {
                $this->activateFromWebhook($payment, $plan, $client, $user);
            }
        } elseif ($event === 'payment.failed') {
            $payment->update([
                'status' => 'failed',
                'gateway_response' => array_merge($payment->gateway_response ?? [], [
                    'webhook_event' => $event,
                    'failure_reason' => $paymentEntity['error_description'] ?? null,
                    'payment_entity' => $paymentEntity,
                ]),
            ]);
        }

        return response()->json(['ok' => true]);
    }

    private function activateFromWebhook(Payment $payment, Plan $plan, Client $client, User $user): void
    {
        DB::transaction(function () use ($payment, $plan, $client, $user) {
            $payment->update(['status' => 'success']);
            // Mail dispatched AFTER commit (see post-transaction call below).

            $client->update([
                'plan_id' => $plan->id,
                'plan_type' => 'paid',
                'status' => 'active',
                'plan_expires_at' => $payment->valid_until,
            ]);

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

        
        $this->invoiceMailer->sendForPayment($payment->fresh());
    }
}
