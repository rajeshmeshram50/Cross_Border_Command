<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Mail\PlanReminderMail;
use App\Models\Payment;
use App\Services\InvoiceMailer;
use App\Support\Settings;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Storage;

class PaymentController extends Controller
{
    public function __construct(private InvoiceMailer $invoiceMailer) {}

    public function index(Request $request)
    {
        $user = $request->user();

        $query = Payment::with(['client:id,org_name', 'plan:id,name,price', 'processedBy:id,name'])
            ->whereHas('client');

        if ($user->isClientAdmin()) {
            $query->where('client_id', $user->client_id);
        } elseif (!$user->isSuperAdmin()) {
            return response()->json(['data' => [], 'total' => 0]);
        }

        if ($search = $request->query('search')) {
            $query->where(function ($q) use ($search) {
                $q->where('txn_id', 'ilike', "%{$search}%")
                  ->orWhere('order_id', 'ilike', "%{$search}%")
                  ->orWhere('invoice_number', 'ilike', "%{$search}%")
                  ->orWhereHas('client', fn($c) => $c->where('org_name', 'ilike', "%{$search}%"));
            });
        }

        if ($status = $request->query('status')) {
            $query->where('status', $status);
        }

        if ($clientId = $request->query('client_id')) {
            $query->where('client_id', $clientId);
        }

        if ($from = $request->query('from')) {
            $query->whereDate('created_at', '>=', $from);
        }

        if ($to = $request->query('to')) {
            $query->whereDate('created_at', '<=', $to);
        }

        $payments = $query->orderBy('created_at', 'desc')
            ->paginate($request->query('per_page', 15));

        return response()->json($payments);
    }

    public function stats(Request $request)
    {
        $user = $request->user();
        $query = Payment::query();

        if ($user->isClientAdmin()) {
            $query->where('client_id', $user->client_id);
        } elseif (!$user->isSuperAdmin()) {
            return response()->json([]);
        }

        $stats = [
            'total_revenue' => (float) (clone $query)->where('status', 'success')->sum('total'),
            'total_transactions' => (clone $query)->count(),
            'successful' => (clone $query)->where('status', 'success')->count(),
            'pending' => (clone $query)->where('status', 'pending')->count(),
            'failed' => (clone $query)->where('status', 'failed')->count(),
            'refunded' => (clone $query)->where('status', 'refunded')->count(),
            'refund_amount' => (float) (clone $query)->where('status', 'refunded')->sum('refund_amount'),
        ];

        return response()->json($stats);
    }

    public function store(Request $request)
    {
        if (!$request->user()->isSuperAdmin()) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        $request->validate([
            'client_id' => 'required|exists:clients,id',
            'plan_id' => 'nullable|exists:plans,id',
            'txn_id' => 'nullable|string|max:100',
            'order_id' => 'nullable|string|max:100',
            'amount' => 'required|numeric|min:0',
            'gst' => 'nullable|numeric|min:0',
            'discount' => 'nullable|numeric|min:0',
            'total' => 'required|numeric|min:0',
            'currency' => 'nullable|string|max:10',
            'method' => 'required|in:upi,credit_card,debit_card,net_banking,wallet,cash,cheque',
            'gateway' => 'nullable|in:razorpay,stripe,paytm,manual',
            'status' => 'required|in:pending,success,failed,refunded',
            'billing_cycle' => 'nullable|in:monthly,quarterly,yearly',
            'valid_from' => 'nullable|date',
            'valid_until' => 'nullable|date',
            'auto_renew' => 'nullable|boolean',
            'notes' => 'nullable|string',
        ]);

        $invoiceNumber = 'INV-' . strtoupper(now()->format('ymdHis'));

        $payment = Payment::create([
            ...$request->only([
                'client_id', 'plan_id', 'txn_id', 'order_id',
                'amount', 'gst', 'discount', 'total', 'currency',
                'method', 'gateway', 'status', 'billing_cycle',
                'valid_from', 'valid_until', 'auto_renew', 'notes',
            ]),
            'invoice_number' => $invoiceNumber,
            'processed_by' => $request->user()->id,
        ]);

        $payment->load(['client', 'plan']);

        // Generate invoice PDF and send email for successful payments
        if ($payment->status === 'success') {
            $this->invoiceMailer->sendForPayment($payment);
        }

        return response()->json([
            'message' => 'Payment recorded successfully' . ($payment->status === 'success' ? '. Invoice sent to client email.' : ''),
            'payment' => $payment,
        ], 201);
    }

    public function show(Payment $payment)
    {
        $payment->load(['client:id,org_name,email', 'plan:id,name,price', 'processedBy:id,name']);
        return response()->json($payment);
    }

    public function destroy(Payment $payment)
    {
        if (!request()->user()->isSuperAdmin()) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        $payment->delete();
        return response()->json(['message' => 'Payment deleted successfully']);
    }

    /**
     * Send plan reminder email to client
     */
    public function sendReminder(Request $request, Payment $payment)
    {
        if (!$request->user()->isSuperAdmin()) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        $payment->load(['client', 'plan']);

        if (!$payment->client || !$payment->client->email) {
            return response()->json(['message' => 'Client email not found'], 422);
        }

        // Gated by Settings → Notifications → planExp (and master emailNotif)
        if (!Settings::shouldSendMail('planExp')) {
            return response()->json([
                'message' => 'Plan expiry notifications are disabled in Settings → Notifications.',
            ], 503);
        }

        try {
            // Send to organization email
            $orgEmail = $payment->client->email;

            // Also find client admin user email
            $adminUser = \App\Models\User::where('client_id', $payment->client->id)
                ->where('user_type', 'client_admin')
                ->first();

            $recipients = collect([$orgEmail]);
            if ($adminUser && $adminUser->email !== $orgEmail) {
                $recipients->push($adminUser->email);
            }

            Mail::to($recipients->toArray())->send(new PlanReminderMail($payment));

            return response()->json([
                'message' => 'Reminder sent to ' . $recipients->join(', '),
            ]);
        } catch (\Exception $e) {
            return response()->json(['message' => 'Failed to send reminder: ' . $e->getMessage()], 500);
        }
    }

    /**
     * Download invoice PDF
     */
    public function downloadInvoice(Request $request, Payment $payment)
    {
        // Support token via query param for direct browser downloads
        $this->authenticateFromQuery($request);

        $payment->load(['client', 'plan']);
        $path = $this->ensureInvoicePdf($payment);

        return response()->download($path, "{$payment->invoice_number}.pdf", [
            'Content-Type' => 'application/pdf',
        ]);
    }

    /**
     * View invoice PDF inline in browser
     */
    public function viewInvoice(Request $request, Payment $payment)
    {
        $this->authenticateFromQuery($request);

        $payment->load(['client', 'plan']);
        $path = $this->ensureInvoicePdf($payment);

        return response()->file($path, [
            'Content-Type' => 'application/pdf',
        ]);
    }

    /**
     * Authenticate user from query string token (for direct browser opens)
     */
    private function authenticateFromQuery(Request $request): void
    {
        if (!$request->user() && $request->query('token')) {
            $token = \Laravel\Sanctum\PersonalAccessToken::findToken($request->query('token'));
            if ($token) {
                $request->setUserResolver(fn() => $token->tokenable);
            } else {
                abort(401, 'Invalid token');
            }
        }

        if (!$request->user()) {
            abort(401, 'Unauthorized');
        }
    }

    /**
     * Ensure PDF exists (delegates to InvoiceMailer) and abort if it
     * couldn't be produced — used by view/download endpoints that need a
     * file path to stream back to the browser.
     */
    private function ensureInvoicePdf(Payment $payment): string
    {
        $path = $this->invoiceMailer->ensureInvoicePdf($payment);
        if (!file_exists($path)) {
            abort(404, 'Invoice not found');
        }
        return $path;
    }
}
