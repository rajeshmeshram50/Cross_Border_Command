<?php

namespace App\Mail;

use App\Models\HiringRequest;
use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

/**
 * Notify an Employee's reporting manager that one of their direct reports
 * has submitted a new Hiring Request, so the manager can review and approve.
 *
 * Triggered from HiringRequestController::store after the row is persisted.
 * Mail goes to the manager's email (preferred — Employee.email; falls back
 * to the linked User.email). Failure is non-fatal: the request still saves
 * even if the SMTP send fails.
 */
class HiringRequestCreatedMail extends Mailable
{
    use Queueable, SerializesModels;

    public HiringRequest $hr;
    public string $managerName;
    public string $creatorName;
    public string $orgName;
    public string $appName;

    public function __construct(
        HiringRequest $hr,
        string $managerName,
        string $creatorName,
        string $orgName
    ) {
        $this->hr          = $hr->loadMissing(['department']);
        $this->managerName = $managerName;
        $this->creatorName = $creatorName;
        $this->orgName     = $orgName;
        $this->appName     = config('mail.from.name', 'Cross Border Command');
    }

    public function envelope(): Envelope
    {
        $code = $this->hr->code ?: ('HRQ-' . $this->hr->id);
        return new Envelope(
            subject: "New Hiring Request #{$code} from {$this->creatorName} — {$this->appName}",
        );
    }

    public function content(): Content
    {
        return new Content(
            view: 'emails.hiring-request-created',
        );
    }
}
