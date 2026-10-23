<?php

namespace App\Jobs;

use App\Mail\PasswordChangedMail;
use App\Mail\WelcomeCredentialsMail;
use App\Models\Client;
use App\Models\User;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;

/**
 * Sends the welcome / credentials mail off the request thread.
 *
 * It fired inline from the employee wizard's Step 4 save, and an SMTP
 * conversation is ~3s locally and 6-7s on production — measured, and the
 * whole of what made that one step take 9-11s while Steps 1-3 were normal
 * (QA #1). Nothing in the save depends on the mail having gone.
 *
 * The RAW PASSWORD IS NOT A CONSTRUCTOR ARGUMENT, deliberately. A queued job
 * is serialised into the `jobs` table as plain JSON, so passing it would write
 * the password to the database in the clear and leave it there until a worker
 * picked it up. Instead this reads users.password_encrypted — the reversibly
 * encrypted copy the caller writes for exactly this purpose — decrypts it,
 * sends, and clears it. That column doubles as the "not sent yet" marker, so a
 * cleared one means the mail already went and this job is a no-op.
 */
class SendWelcomeCredentials implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $timeout = 60;
    public int $tries = 3;

    public function __construct(
        public int $userId,
        public string $userType = 'employee',
        public ?string $loginUrl = null,
    ) {}

    /** Wait between retries: 30s, then 2min. */
    public function backoff(): array
    {
        return [30, 120];
    }

    public function handle(): void
    {
        $user = User::find($this->userId);
        if (!$user || !$user->email || !$user->password_encrypted) {
            return;   // already sent, or nothing to send to
        }

        try {
            $raw = Crypt::decryptString($user->password_encrypted);
        } catch (\Throwable $e) {
            // An undecryptable value cannot be mailed and must not be retried.
            Log::warning('Welcome credentials: password_encrypted unreadable', [
                'user' => $this->userId, 'err' => $e->getMessage(),
            ]);
            $user->forceFill(['password_encrypted' => null])->save();
            return;
        }

        Mail::to($user->email)->send(new WelcomeCredentialsMail(
            $user->name,
            $user->email,
            $raw,
            $this->userType,
            Client::find($user->client_id)?->org_name ?? 'Your Organization',
            $this->loginUrl ?: PasswordChangedMail::defaultLoginUrl(),
        ));

        // Cleared only after a successful send, so a failed attempt retries
        // with the password still readable.
        $user->forceFill(['password_encrypted' => null])->save();
    }
}
