<?php

namespace App\Services;

use App\Mail\PaymentInvoiceMail;
use App\Models\Payment;
use App\Models\User;
use App\Support\Settings;
use Barryvdh\DomPDF\Facade\Pdf;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;

class InvoiceMailer
{
    public function sendForPayment(Payment $payment): void
    {
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
