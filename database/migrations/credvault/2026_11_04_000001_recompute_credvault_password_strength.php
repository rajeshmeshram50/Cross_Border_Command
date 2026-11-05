<?php

use App\Models\CredVault\Credential;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * The password strength criteria (D34) replace the old 5-point meter:
 * Strong = 12+ characters with letters, numbers and a special character;
 * Good = 8+ with all three; anything else Fair (counts as weak). The stored
 * `strength` of every password credential is worked out again, so lists,
 * Password Health and the dashboard read the new levels. updated_at is left
 * alone: nothing about the credential changed. A secret that cannot be
 * decrypted is skipped and logged, never cleared.
 */
return new class extends Migration
{
    public function up(): void
    {
        $types = array_values(array_filter(array_keys(Credential::TYPES), fn ($t) => Credential::secretIsPassword($t)));

        Credential::withTrashed()->whereIn('type', $types)->select(['id', 'type', 'secret', 'strength'])
            ->chunkById(200, function ($rows) {
                foreach ($rows as $c) {
                    try {
                        $level = Credential::strengthOf($c->secret);
                    } catch (\Throwable $e) {
                        Log::warning('CredVault strength recompute: secret not readable', ['credential_id' => $c->id]);
                        continue;
                    }
                    if ($level !== (int) $c->strength) DB::table('credvault_credentials')->where('id', $c->id)->update(['strength' => $level]);
                }
            });
    }

    /** The old meter's scores cannot be rebuilt without it; the D34 levels stay. */
    public function down(): void
    {
    }
};
