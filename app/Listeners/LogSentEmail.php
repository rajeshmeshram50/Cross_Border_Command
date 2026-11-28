<?php

namespace App\Listeners;

use App\Models\EmailLog;
use App\Models\Employee;
use App\Models\User;
use Illuminate\Mail\Events\MessageSending;
use Illuminate\Support\Facades\Log;
use Symfony\Component\Mime\Email;

class LogSentEmail
{
    private const SENSITIVE_CATEGORIES = ['otp', 'credentials', 'password'];

    public static ?array $composedAttachments = null;

    public function handle(MessageSending $event): void
    {
        try {
            $message = $event->message;
            if (!$message instanceof Email) {
                return;
            }

            $category = $this->deriveCategory($event->data ?? []);
            $mailableClass = $event->data['__laravel_mailable'] ?? null;

            $from = $this->firstAddress($message->getFrom());
            $fromName = \App\Support\TenantMailFrom::resolve($message)
                ?? ($from['name'] ?? config('mail.from.name'));
            $cc   = $this->addressList($message->getCc());
            $bcc  = $this->addressList($message->getBcc());

            $subject  = (string) ($message->getSubject() ?? '');
            $bodyHtml = $this->bodyToString($message->getHtmlBody());
            $bodyText = $this->bodyToString($message->getTextBody());
            $hasAttachments = count($message->getAttachments()) > 0;

            $attachmentMeta = ($category === 'composed') ? static::$composedAttachments : null;

            if (in_array($category, self::SENSITIVE_CATEGORIES, true)) {
                $bodyHtml = '<p style="color:#6b7280;font-style:italic;">[Sensitive content withheld — the body of this email is not stored for security reasons.]</p>';
                $bodyText = '[Sensitive content withheld — not stored for security reasons.]';
            }

            $actor = auth()->user();

            $recipients = $message->getTo();
            if (empty($recipients)) {
                return;
            }

            foreach ($recipients as $to) {
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
                    'from_email'      => $this->clip($from['email'] ?? config('mail.from.address'), 191),
                    'from_name'       => $this->clip($fromName, 191),
                    'to_email'        => $this->clip($toEmail, 191),
                    'to_name'         => $this->clip($toName, 191),
                    'cc'              => $cc ?: null,
                    'bcc'             => $bcc ?: null,
                    'subject'         => mb_substr($subject, 0, 255),
                    'body_html'       => $bodyHtml,
                    'body_text'       => $bodyText,
                    'has_attachments' => $hasAttachments,
                    'attachments'     => $attachmentMeta,
                    'status'          => 'sent',
                    'sent_at'         => now(),
                ]);
            }
        } catch (\Throwable $e) {
            Log::warning('LogSentEmail failed', ['error' => $e->getMessage()]);
        }
    }

    private function resolveMapping(?User $actor, string $toEmail): array
    {
        $clientId = null;
        $branchId = null;
        $employeeId = null;

        if ($actor && $actor->user_type !== 'super_admin') {
            $clientId = $actor->client_id;
            $branchId = $actor->branch_id;
        }

        $emp = Employee::query()
            ->whereRaw('LOWER(email) = ?', [mb_strtolower($toEmail)])
            ->first(['id', 'client_id', 'branch_id']);
        if ($emp) {
            $employeeId = $emp->id;
            $clientId ??= $emp->client_id;
            $branchId ??= $emp->branch_id;
        }

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

    private function firstAddress(array $addresses): array
    {
        foreach ($addresses as $a) {
            return ['email' => $a->getAddress(), 'name' => $a->getName() ?: null];
        }
        return [];
    }

    private function addressList(array $addresses): array
    {
        $out = [];
        foreach ($addresses as $a) {
            $out[] = ['email' => $a->getAddress(), 'name' => $a->getName() ?: null];
        }
        return $out;
    }

    private function clip(?string $value, int $len): ?string
    {
        if ($value === null) return null;
        return mb_substr($value, 0, $len);
    }

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
