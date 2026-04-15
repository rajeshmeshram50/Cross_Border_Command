<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Client;
use App\Models\Payment;
use App\Models\Permission;
use App\Models\Plan;
use App\Models\PlanModule;
use App\Models\Module;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class SubscriptionController extends Controller
{
    /**
     * Get available plans for client to buy
     */
    public function plans()
    {
        $plans = Plan::where('status', 'active')
            ->with('modules:id,name,slug,icon')
            ->orderBy('sort_order')
            ->get();

        return response()->json($plans);
    }

    /**
     * Get current subscription status for the logged-in client
     */
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
     * Subscribe to a plan (dummy payment)
     */
    public function subscribe(Request $request)
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

        // Calculate amount
        $basePrice = (float) $plan->price;
        $multiplier = match ($request->billing_cycle) {
            'quarter' => 3,
            'year' => 12,
            default => 1,
        };
        $amount = $basePrice * $multiplier;

        // Apply yearly discount
        if ($request->billing_cycle === 'year' && $plan->yearly_discount > 0) {
            $amount = $amount * (1 - $plan->yearly_discount / 100);
        }

        $gst = round($amount * 0.18, 2);
        $total = round($amount + $gst, 2);

        // Calculate validity
        $validFrom = now();
        $validUntil = match ($request->billing_cycle) {
            'quarter' => now()->addMonths(3),
            'year' => now()->addYear(),
            default => now()->addMonth(),
        };

        $txnId = 'TXN-' . now()->format('Ymd') . '-' . strtoupper(Str::random(6));
        $orderId = 'ORD-' . now()->format('Ymd') . '-' . strtoupper(Str::random(6));

        return DB::transaction(function () use ($request, $plan, $client, $user, $amount, $gst, $total, $validFrom, $validUntil, $txnId, $orderId) {
            // Create payment record
            Payment::create([
                'client_id' => $client->id,
                'plan_id' => $plan->id,
                'txn_id' => $txnId,
                'order_id' => $orderId,
                'amount' => $amount,
                'gst' => $gst,
                'discount' => 0,
                'total' => $total,
                'currency' => 'INR',
                'method' => $request->payment_method,
                'gateway' => 'razorpay',
                'billing_cycle' => $request->billing_cycle,
                'valid_from' => $validFrom,
                'valid_until' => $validUntil,
                'auto_renew' => false,
                'status' => 'success',
                'invoice_number' => 'INV-' . now()->format('Ymd') . '-' . strtoupper(Str::random(4)),
                'processed_by' => $user->id,
            ]);

            // Update client plan
            $client->update([
                'plan_id' => $plan->id,
                'plan_type' => 'paid',
                'status' => 'active',
                'plan_expires_at' => $validUntil,
            ]);

            // Set permissions from plan modules for the client admin
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

            return response()->json([
                'message' => 'Plan activated successfully',
                'txn_id' => $txnId,
                'plan' => $plan->name,
                'total' => $total,
                'valid_until' => $validUntil->format('Y-m-d'),
            ]);
        });
    }
}
