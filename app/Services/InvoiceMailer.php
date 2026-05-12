<?php

namespace App\Services;

use App\Mail\PaymentInvoiceMail;
use App\Models\Payment;
use App\Models\User;
use App\Support\Settings;
use Barryvdh\DomPDF\Facade\Pdf;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;

/**
 * Single source of truth for the "payment success → invoice PDF + mail" flow.
 *
 * Lives in a service (rather than as a private method on PaymentController)
 * because three different controllers terminate on payment success and ALL of
 * them must trigger the same invoice mail:
 *
 *   - PaymentController::store              (super-admin manual payment entry)
 *   - SubscriptionController::activatePlan  (customer self-checkout, post-verify)
 *   - RazorpayWebhookController::activateFromWebhook  (async webhook arrival)
 *
 * The previous version only fired from PaymentController, so customers paying
 * through the actual Razorpay flow never received an invoice in their inbox —
 * a billing/audit gap the QA team caught.
 */
class InvoiceMailer
{
    /**
     * Generate the invoice PDF (idempotent — only writes if missing) and
     * dispatch the invoice mail to the org email plus, if different, the
     * client_admin's user email. Failures are LOGGED but NEVER re-thrown:
     * a transient SMTP / PDF hiccup must not roll back a successful payment.
     */
    public function sendForPayment(Payment $payment): void
    {
        // Invoice is TRANSACTIONAL — every successful payment must produce
        // an invoice in the customer's inbox. We honour ONLY the master
        // `emailNotif` kill-switch (explicit nuclear option for admins who
        // disable ALL platform mail) — we deliberately do NOT gate on the
        // `payAlerts` category. That toggle is reserved for non-transactional
        // payment alerts (e.g. "card expiring soon"), so an admin who turns
        // off "Payment Alerts" doesn't silently break invoicing — which would
        // be a billing/audit compliance gap.
        //
        // PDF is generated regardless of mail outcome so super_admin can
        // always download it from the Payments page even when SMTP is down.
        try {
            $payment->loadMissing(['client', 'plan']);

            $this->ensureInvoicePdf($payment);

            if (!Settings::shouldSendMail()) {
                Log::info('Invoice mail skipped — master emailNotif is OFF', [
                    'payment_id' => $payment->id,
                ]);
                return;
            }

            $orgEmail = $payment->client?->email;
            if (!$orgEmail) {
                Log::warning('Invoice mail skipped — client has no email', [
                    'payment_id' => $payment->id,
                    'client_id'  => $payment->client_id,
                ]);
                return;
            }

            $adminUser = User::where('client_id', $payment->client_id)
                ->where('user_type', 'client_admin')
                ->first();

            $recipients = [$orgEmail];
            if ($adminUser && $adminUser->email && $adminUser->email !== $orgEmail) {
                $recipients[] = $adminUser->email;
            }

            Mail::to($recipients)->send(new PaymentInvoiceMail($payment));
        } catch (\Throwable $e) {
            Log::error('Invoice generation/email failed', [
                'payment_id' => $payment->id ?? null,
                'error'      => $e->getMessage(),
            ]);
        }
    }

    /**
     * Render and persist the invoice PDF if it isn't already on disk. Stores
     * the relative path on the Payment row so subsequent fetches can short-
     * circuit. Returns the absolute filesystem path.
     */
    public function ensureInvoicePdf(Payment $payment): string
    {
        $invoicesDir = storage_path('app/invoices');
        if (!is_dir($invoicesDir)) {
            mkdir($invoicesDir, 0755, true);
        }

        $path = $invoicesDir . DIRECTORY_SEPARATOR . "{$payment->invoice_number}.pdf";
        if (file_exists($path)) {
            return $path;
        }

        $payment->loadMissing(['client', 'plan']);

        $pdf = Pdf::loadView('invoices.payment-invoice', ['payment' => $payment]);
        $pdf->setPaper('A4');
        $pdf->save($path);

        $payment->update(['invoice_path' => "invoices/{$payment->invoice_number}.pdf"]);

        return $path;
    }
}
