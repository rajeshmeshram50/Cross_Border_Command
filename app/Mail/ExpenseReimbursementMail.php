<?php

namespace App\Mail;

use App\Models\ExpenseClaim;
use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Attachment;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

class ExpenseReimbursementMail extends Mailable
{
    use Queueable, SerializesModels;

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
