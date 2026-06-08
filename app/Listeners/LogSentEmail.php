<?php

namespace App\Listeners;

use App\Models\EmailLog;
use App\Models\Employee;
use App\Models\User;
use Illuminate\Mail\Events\MessageSending;
use Illuminate\Support\Facades\Log;
use Symfony\Component\Mime\Address;
use Symfony\Component\Mime\Email;

/**
 * Records every outbound email to the email_logs table so the Gmail page has a
 * complete, branch- and employee-mapped history. Wired to Laravel's
 * MessageSending event in AppServiceProvider — this means EVERY existing
 * Mail::send (OTP, welcome credentials, payslips, sales docs, announcements,
 * invoices, …) is captured with zero changes to the 27 sending sites, and any
 * future mailable is logged automatically too.
 *
 * One row is written per recipient address so the "By Employee" / "By Branch"
 * tabs map cleanly. Nothing here ever throws — a logging failure must never
 * prevent (or roll back) the actual email going out.
 */
class LogSentEmail
{
    /** Categories whose body holds a secret and must never be persisted. */
    private const SENSITIVE_CATEGORIES = ['otp', 'credentials', 'password'];

    public function handle(MessageSending $event): void
    {
        try {
            /** @var Email $message */
            $message = $event->message;
            if (!$message instanceof Email) {
                return;
            }

            $category = $this->deriveCategory($event->data ?? []);
            $mailableClass = $event->data['__laravel_mailable'] ?? null;

            $from = $this->firstAddress($message->getFrom());
            $cc   = $this->addressList($message->getCc());
            $bcc  = $this->addressList($message->getBcc());

            $subject  = (string) ($message->getSubject() ?? '');
            $bodyHtml = $this->bodyToString($message->getHtmlBody());
            $bodyText = $this->bodyToString($message->getTextBody());
            $hasAttachments = count($message->getAttachments()) > 0;

            // Never persist the body of secret-bearing mails — welcome
            // credentials carry the plaintext password and OTP mails carry the
            // code. The history still records that the mail went out (to whom,
            // when, which kind) but the secret itself is dropped, so an admin
            // browsing the Gmail page can't harvest passwords / OTPs.
            if (in_array($category, self::SENSITIVE_CATEGORIES, true)) {
                $bodyHtml = '<p style="color:#6b7280;font-style:italic;">[Sensitive content withheld — the body of this email is not stored for security reasons.]</p>';
                $bodyText = '[Sensitive content withheld — not stored for security reasons.]';
            }

            // Sender tenant context — only present inside an authenticated
            // request (most sends). Transactional system mails (OTP) run
            // unauthenticated; we fall back to the recipient's own row below.
            $actor = auth()->user();

            $recipients = $message->getTo();
            if (empty($recipients)) {
                return;
            }

            foreach ($recipients as $to) {
                /** @var Address $to */
                $toEmail = $to->getAddress();
                $toName  = $to->getName() ?: null;

                [$clientId, $branchId, $employeeId] = $this->resolveMapping($actor, $toEmail);

                EmailLog::create([
                    'client_id'       => $clientId,
                    'branch_id'       => $branchId,
                    'user_id'         => $actor?->id,
                    'employee_id'     => $employeeId,
                    'direction'       => 'outbound',
                    'category'        => $category,
                    'mailable_class'  => $this->clip($mailableClass, 191),
                    // Clip the varchar(191) columns so an over-long address or
                    // display name can't throw and lose the whole history row.
                    'from_email'      => $this->clip($from['email'] ?? config('mail.from.address'), 191),
                    'from_name'       => $this->clip($from['name'] ?? config('mail.from.name'), 191),
                    'to_email'        => $this->clip($toEmail, 191),
                    'to_name'         => $this->clip($toName, 191),
                    'cc'              => $cc ?: null,
                    'bcc'             => $bcc ?: null,
                    'subject'         => mb_substr($subject, 0, 255),
                    'body_html'       => $bodyHtml,
                    'body_text'       => $bodyText,
                    'has_attachments' => $hasAttachments,
                    'status'          => 'sent',
                    'sent_at'         => now(),
                ]);
            }
        } catch (\Throwable $e) {
            // Never let logging break the mail pipeline.
            Log::warning('LogSentEmail failed', ['error' => $e->getMessage()]);
        }
    }

    /**
     * Resolve [client_id, branch_id, employee_id] for one recipient.
     * Prefers the authenticated sender's tenant (the mail belongs to their
     * org); fills client/branch from the recipient's own user/employee row
     * when there is no sender (system mails) or the sender is a super_admin
     * acting across tenants.
     */
    private function resolveMapping(?User $actor, string $toEmail): array
    {
        $clientId = null;
        $branchId = null;
        $employeeId = null;

        if ($actor && $actor->user_type !== 'super_admin') {
            $clientId = $actor->client_id;
            $branchId = $actor->branch_id;
        }

        // Match the recipient to an employee — drives the "By Employee" tab and
        // backfills tenant context when the sender didn't supply it.
        $emp = Employee::query()
            ->whereRaw('LOWER(email) = ?', [mb_strtolower($toEmail)])
            ->first(['id', 'client_id', 'branch_id']);
        if ($emp) {
            $employeeId = $emp->id;
            $clientId ??= $emp->client_id;
            $branchId ??= $emp->branch_id;
        }

        // Still no tenant? Try a matching user account (e.g. branch contact,
        // forgot-password OTP recipient).
        if ($clientId === null) {
            $u = User::query()
                ->whereRaw('LOWER(email) = ?', [mb_strtolower($toEmail)])
                ->first(['id', 'client_id', 'branch_id']);
            if ($u) {
                $clientId = $u->client_id;
                $branchId ??= $u->branch_id;
            }
        }

        return [$clientId, $branchId, $employeeId];
    }

    /** Short bucket from the mailable class name (e.g. PasswordResetOtpMail → otp). */
    private function deriveCategory(array $data): ?string
    {
        $class = $data['__laravel_mailable'] ?? null;
        if (!$class) return null;
        $base = class_basename($class);

        return match (true) {
            str_contains($base, 'Otp'),
            str_contains($base, 'PasswordReset')   => 'otp',
            str_contains($base, 'PasswordChanged')  => 'password',
            str_contains($base, 'WelcomeCredentials') => 'credentials',
            str_contains($base, 'OnboardingInvite') => 'onboarding',
            str_contains($base, 'Payslip')          => 'payslip',
            str_contains($base, 'Announcement')     => 'announcement',
            str_contains($base, 'HiringRequest')    => 'recruitment',
            str_contains($base, 'SalesReminder'),
            str_contains($base, 'SalesDocument')    => 'sales',
            str_contains($base, 'SignedDocument')   => 'signature',
            str_contains($base, 'PaymentInvoice'),
            str_contains($base, 'PlanReminder')     => 'billing',
            str_contains($base, 'Composed')         => 'composed',
            default                                  => 'other',
        };
    }

    /** @param Address[] $addresses */
    private function firstAddress(array $addresses): array
    {
        foreach ($addresses as $a) {
            return ['email' => $a->getAddress(), 'name' => $a->getName() ?: null];
        }
        return [];
    }

    /** @param Address[] $addresses @return list<array{email:string,name:?string}> */
    private function addressList(array $addresses): array
    {
        $out = [];
        foreach ($addresses as $a) {
            $out[] = ['email' => $a->getAddress(), 'name' => $a->getName() ?: null];
        }
        return $out;
    }

    /** Clip a value to a column length, preserving null. */
    private function clip(?string $value, int $len): ?string
    {
        if ($value === null) return null;
        return mb_substr($value, 0, $len);
    }

    /** Symfony bodies can be a string or a stream resource. */
    private function bodyToString($body): ?string
    {
        if ($body === null) return null;
        if (is_resource($body)) {
            $contents = stream_get_contents($body);
            return $contents === false ? null : $contents;
        }
        return (string) $body;
    }
}
