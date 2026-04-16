<?php

namespace App\Mail;

use App\Models\Payment;
use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Attachment;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

class PaymentInvoiceMail extends Mailable
{
    use Queueable, SerializesModels;

    public Payment $payment;

    public function __construct(Payment $payment)
    {
        $this->payment = $payment->load(['client', 'plan']);
    }

    public function envelope(): Envelope
    {
        return new Envelope(
            subject: "Payment Invoice #{$this->payment->invoice_number} — Cross Border Command",
        );
    }

    public function content(): Content
    {
        return new Content(
            view: 'emails.payment-invoice',
        );
    }

    /**
     * @return array<int, Attachment>
     */
    public function attachments(): array
    {
        $invoicePath = storage_path("app/invoices/{$this->payment->invoice_number}.pdf");

        if (file_exists($invoicePath)) {
            return [
                Attachment::fromPath($invoicePath)
                    ->as("{$this->payment->invoice_number}.pdf")
                    ->withMime('application/pdf'),
            ];
        }

        return [];
    }
}
