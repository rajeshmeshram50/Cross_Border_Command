<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Mail\SubscriptionExpiryReminderMail;
use App\Models\IntegrationSubscription;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Mail;
use Illuminate\Validation\Rule;

/**
 * CRUD for the GLOBAL third-party subscription / integration expiry tracker.
 *
 * These are the SaaS operator's OWN vendor subscriptions (Zoho, Razorpay,
 * Azure, domains, SSL, API plans), so the register is company-wide and gated to
 * super-admins — it is deliberately NOT scoped by client_id. The daily
 * SendSubscriptionExpiryReminders command consumes these rows.
 */
class IntegrationSubscriptionController extends Controller
{
    /** Only super-admins manage the company's own vendor subscriptions. */
    private function authorizeSuper(Request $request): void
    {
        $user = $request->user();
        abort_unless($user && $user->isSuperAdmin(), 403, 'Only super-admins can manage integration subscriptions.');
    }

    public function index(Request $request)
    {
        $this->authorizeSuper($request);

        $rows = IntegrationSubscription::orderBy('expires_at')->get()->map(function (IntegrationSubscription $s) {
            $arr = $s->toArray();
            // Derived fields the UI shows without re-deriving on the client.
            $arr['days_left']       = $s->daysLeft();
            $arr['computed_status'] = $s->computedStatus();
            return $arr;
        });

        return response()->json(['data' => $rows]);
    }

    public function store(Request $request)
    {
        $this->authorizeSuper($request);
        $data = $this->validated($request);
        $data['created_by']     = $request->user()->id;
        $data['reminders_sent'] = [];

        $row = IntegrationSubscription::create($data);
        return response()->json(['data' => $row], 201);
    }

    public function update(Request $request, IntegrationSubscription $integrationSubscription)
    {
        $this->authorizeSuper($request);
        $data = $this->validated($request);

        // If the renewal date moved, the service has (or will be) renewed —
        // start a fresh reminder cycle so the new date's milestones fire again.
        if (!$integrationSubscription->expires_at->equalTo($data['expires_at'])) {
            $data['reminders_sent'] = [];
            $data['last_reminded_on'] = null;
        }

        $integrationSubscription->update($data);
        return response()->json(['data' => $integrationSubscription->fresh()]);
    }

    public function destroy(Request $request, IntegrationSubscription $integrationSubscription)
    {
        $this->authorizeSuper($request);
        $integrationSubscription->delete();
        return response()->json(['message' => 'Deleted']);
    }

    /** Fire a one-off reminder email now, so the owner/setup can be verified. */
    public function sendTest(Request $request, IntegrationSubscription $integrationSubscription)
    {
        $this->authorizeSuper($request);
        try {
            Mail::to($integrationSubscription->owner_email)
                ->send(new SubscriptionExpiryReminderMail($integrationSubscription, $integrationSubscription->daysLeft()));
        } catch (\Throwable $e) {
            return response()->json(['message' => 'Could not send: ' . $e->getMessage()], 502);
        }
        return response()->json(['message' => "Test reminder sent to {$integrationSubscription->owner_email}"]);
    }

    private function validated(Request $request): array
    {
        return $request->validate([
            'name'           => 'required|string|max:150',
            'provider'       => 'nullable|string|max:100',
            'category'       => 'nullable|string|max:60',
            'owner_name'     => 'nullable|string|max:120',
            'owner_email'    => 'required|email|max:150',
            'expires_at'     => 'required|date',
            'reminder_days'  => 'required|array|min:1',
            'reminder_days.*'=> 'integer|min:0|max:365',
            'auto_renew'     => 'boolean',
            'status'         => ['nullable', Rule::in(['active', 'expired', 'cancelled'])],
            'amount'         => 'nullable|numeric|min:0',
            'currency'       => 'nullable|string|size:3',
            'notes'          => 'nullable|string|max:1000',
        ]);
    }
}
