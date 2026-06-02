<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Companion to 2026_06_02_000200_lock_address_types_to_three_fixed.
 *
 * That migration deleted non-system rows aggressively. On databases
 * where Warehouse / Billing Address only existed as tenant-scoped (or
 * non-system global) rows, the cleanup step wiped them BEFORE the
 * upsert path could promote them. Result: only "Registered Address"
 * survives, leaving the master with 1 row instead of 3.
 *
 * This migration force-inserts Warehouse + Billing Address as global
 * is_system=true rows if they're missing. Idempotent.
 */
return new class extends Migration
{
    public function up(): void
    {
        foreach (['Warehouse', 'Billing Address'] as $name) {
            $exists = DB::table('master_address_types')
                ->whereNull('client_id')
                ->whereNull('branch_id')
                ->whereRaw('LOWER(name) = ?', [strtolower($name)])
                ->exists();

            if (!$exists) {
                DB::table('master_address_types')->insert([
                    'client_id'  => null,
                    'branch_id'  => null,
                    'name'       => $name,
                    'status'     => 'Active',
                    'is_system'  => true,
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);
            } else {
                // Belt-and-braces: ensure existing row has the correct flags.
                DB::table('master_address_types')
                    ->whereNull('client_id')
                    ->whereNull('branch_id')
                    ->whereRaw('LOWER(name) = ?', [strtolower($name)])
                    ->update([
                        'name'       => $name,
                        'status'     => 'Active',
                        'is_system'  => true,
                        'updated_at' => now(),
                    ]);
            }
        }
    }

    public function down(): void
    {
        // No-op — these are canonical product entries, not safe to remove.
    }
};
