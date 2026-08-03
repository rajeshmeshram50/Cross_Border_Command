<?php

namespace App\Mail;

use App\Models\ExpenseClaim;
use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Attachment;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

/**
 * Sent to the employee once their expense claim is fully paid AND every payment
 * is synced to Zoho Books — a reimbursement confirmation with the claimed /
 * added / deducted / net-paid breakdown, the payment installments, and the
 * uploaded proof files attached.
 */
class ExpenseReimbursementMail extends Mailable
{
    use Queueable, SerializesModels;

    /** @param array<int,array{path:string,name:string}> $proofFiles */
    public function __construct(
        public ExpenseClaim $claim,
        public string $employeeName,
        public string $orgName,
        public array $proofFiles = [],
    ) {}

    public function envelope(): Envelope
    {
        $code = $this->claim->claim_no ?: ('EXP-' . $this->claim->id);
        return new Envelope(
            subject: "Reimbursement processed · {$code} — {$this->orgName}",
        );
    }

    public function content(): Content
    {
        return new Content(view: 'emails.expense-reimbursement');
    }

    public function attachments(): array
    {
        $out = [];
        foreach ($this->proofFiles as $f) {
            if (empty($f['path'])) continue;
            $out[] = Attachment::fromStorageDisk('public', $f['path'])
                ->as($f['name'] ?? basename($f['path']));
        }
        return $out;
    }
}
