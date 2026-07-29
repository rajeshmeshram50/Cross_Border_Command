<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * One-time registration of the on-site eSSL terminal in the tenant that owns the
 * enrolled employees (production: client 10 "IGC Compaines" / branch 27
 * "Healthcare"). An unregistered serial is acked-but-dropped by the /iclock
 * receiver, so the device must exist in device_terminals before any punch can
 * ingest.
 *
 * GUARDED + IDEMPOTENT: only inserts where that client + branch actually exist,
 * so it is a NO-OP on local / staging / any env that doesn't have this tenant,
 * and re-running never duplicates. Set `allowed_ips` afterwards in
 * HR → Biometric Devices to lock Mode C down to the office IP.
 *
 * See docs/ESSL_GO_LIVE_CHECKLIST.md §3.
 */
return new class extends Migration {
    private int $clientId = 10;
    private int $branchId = 27;
    private string $serial = 'NFZ8252004771';

    public function up(): void
    {
        $hasClient = DB::table('clients')->where('id', $this->clientId)->exists();
        $hasBranch = DB::table('branches')->where('id', $this->branchId)
            ->where('client_id', $this->clientId)->exists();

        // Not this environment (e.g. local has no client 10) — skip cleanly.
        if (!$hasClient || !$hasBranch) {
            return;
        }
        // Already registered (via UI/tinker or a prior run) — leave it as-is.
        if (DB::table('device_terminals')->where('serial', $this->serial)->exists()) {
            return;
        }

        DB::table('device_terminals')->insert([
            'client_id'  => $this->clientId,
            'branch_id'  => $this->branchId,
            'serial'     => $this->serial,
            'name'       => 'eSSL x2008 (on-site)',
            'timezone'   => 'Asia/Kolkata',
            'is_active'  => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    public function down(): void
    {
        DB::table('device_terminals')
            ->where('serial', $this->serial)
            ->where('client_id', $this->clientId)
            ->delete();
    }
};
