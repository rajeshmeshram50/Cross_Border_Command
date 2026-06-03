<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Rename the system-fixed "Registered Address" row back to
 * "Registered Office" — QA confirmed the canonical product naming
 * is "Registered Office" and the earlier migration
 * (2026_06_02_000200_lock_address_types_to_three_fixed) had renamed
 * it the wrong way.
 *
 * Idempotent: case-insensitive lookup so re-running has no effect once
 * the row already says "Registered Office".
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::table('master_address_types')
            ->whereNull('client_id')
            ->whereNull('branch_id')
            ->whereRaw('LOWER(name) = ?', ['registered address'])
            ->update([
                'name'       => 'Registered Office',
                'is_system'  => true,
                'status'     => 'Active',
                'updated_at' => now(),
            ]);
    }

    public function down(): void
    {
        DB::table('master_address_types')
            ->whereNull('client_id')
            ->whereNull('branch_id')
            ->whereRaw('LOWER(name) = ?', ['registered office'])
            ->update([
                'name'       => 'Registered Address',
                'updated_at' => now(),
            ]);
    }
};
