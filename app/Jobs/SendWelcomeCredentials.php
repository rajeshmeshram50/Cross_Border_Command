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

    public function backoff(): array
    {
        return [30, 120];
    }

    public function handle(): void
    {
        $user = User::find($this->userId);
        if (!$user || !$user->email || !$user->password_encrypted) {
            return;
        }

        try {
            $raw = Crypt::decryptString($user->password_encrypted);
        } catch (\Throwable $e) {
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

        $user->forceFill(['password_encrypted' => null])->save();
    }
}
