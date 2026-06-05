<?php

namespace App\Mail;

use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Attachment;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;

/**
 * Emails one employee their payslip PDF. Not queued — the PDF bytes are passed
 * in directly (a generated blob), and payroll-email is dispatched inline so HR
 * gets an immediate success/failure per recipient rather than a silent queue.
 */
class PayslipMail extends Mailable
{
    public function __construct(
        public string $employeeName,
        public string $periodLabel,
        public string $companyName,
        public ?string $hrEmail,
        public string $pdfBytes,
        public string $pdfFilename,
    ) {}

    public function envelope(): Envelope
    {
        return new Envelope(
            subject: "Payslip — {$this->periodLabel} — {$this->companyName}",
        );
    }

    public function content(): Content
    {
        return new Content(
            view: 'emails.payslip',
            with: [
                'employeeName' => $this->employeeName,
                'periodLabel'  => $this->periodLabel,
                'companyName'  => $this->companyName,
                'hrEmail'      => $this->hrEmail,
            ],
        );
    }

    /** @return array<int, Attachment> */
    public function attachments(): array
    {
        return [
            Attachment::fromData(fn () => $this->pdfBytes, $this->pdfFilename)
                ->withMime('application/pdf'),
        ];
    }
}
