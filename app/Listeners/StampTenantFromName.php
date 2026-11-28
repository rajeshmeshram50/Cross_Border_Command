<?php

namespace App\Listeners;

use App\Support\TenantMailFrom;
use Illuminate\Mail\Events\MessageSending;
use Illuminate\Support\Facades\Log;
use Symfony\Component\Mime\Address;
use Symfony\Component\Mime\Email;

/**
 * Rewrites the "From" display name of every outgoing email to the sending
 * tenant's "Client name - Branch name", keeping the configured from address.
 * Runs before the transport sends, so the delivered mail always carries the
 * tenant identity. Falls back to the configured MAIL_FROM_NAME when no tenant
 * can be resolved (e.g. super-admin / platform mails).
 */
class StampTenantFromName
{
    public function handle(MessageSending $event): void
    {
        try {
            $message = $event->message;
            if (!$message instanceof Email) {
                return;
            }

            $name = TenantMailFrom::resolve($message);
            if ($name === null || $name === '') {
                return;
            }

            $from    = $message->getFrom()[0] ?? null;
            $address = $from?->getAddress() ?: config('mail.from.address');
            if (!$address) {
                return;
            }

            $message->from(new Address($address, $name));
        } catch (\Throwable $e) {
            Log::warning('StampTenantFromName failed', ['error' => $e->getMessage()]);
        }
    }
}
