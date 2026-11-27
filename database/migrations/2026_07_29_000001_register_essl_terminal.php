<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration {
    private int $clientId = 10;
    private int $branchId = 27;
    private string $serial = 'NFZ8252004771';

    public function up(): void
    {
        $hasClient = DB::table('clients')->where('id', $this->clientId)->exists();
        $hasBranch = DB::table('branches')->where('id', $this->branchId)
            ->where('client_id', $this->clientId)->exists();

        if (!$hasClient || !$hasBranch) {
            return;
        }
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
