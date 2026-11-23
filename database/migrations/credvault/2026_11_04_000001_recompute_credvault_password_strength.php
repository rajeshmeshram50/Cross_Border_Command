<?php

use App\Models\CredVault\Credential;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

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

    public function down(): void
    {
    }
};
