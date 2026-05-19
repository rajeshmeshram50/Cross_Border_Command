<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Replace the prior single "Office" system entry with the three
 * canonical address types the product actually needs:
 *
 *   1. Registered Office
 *   2. Warehouse
 *   3. Billing Address
 *
 * Each is upserted (case-insensitive name match on global rows) so
 * re-running migrations never duplicates or conflicts with a
 * manually-created entry sharing the same name — the existing one
 * just gets promoted to is_system=true in place.
 *
 * The old "Office" seed (from migration 2026_05_19_000001) is
 * demoted (is_system=false) rather than deleted. If the tenant had
 * already referenced it from an employee address, removing it would
 * break that link; demoting lets an admin manually clean it up.
 */
return new class extends Migration
{
    public function up(): void
    {
        // ── 1. Demote the legacy "Office" seed so it stops claiming
        //       protected/system status. Admins can delete it manually.
        DB::table('master_address_types')
            ->whereNull('client_id')
            ->whereNull('branch_id')
            ->whereRaw('LOWER(name) = ?', ['office'])
            ->update(['is_system' => false, 'updated_at' => now()]);

        // ── 2. Upsert the three canonical fixed entries.
        $fixed = ['Registered Office', 'Warehouse', 'Billing Address'];
        foreach ($fixed as $name) {
            $existing = DB::table('master_address_types')
                ->whereNull('client_id')
                ->whereNull('branch_id')
                ->whereRaw('LOWER(name) = ?', [strtolower($name)])
                ->first();

            if ($existing) {
                DB::table('master_address_types')
                    ->where('id', $existing->id)
                    ->update([
                        'name'       => $name,        // canonical casing
                        'status'     => 'Active',
                        'is_system'  => true,
                        'updated_at' => now(),
                    ]);
            } else {
                DB::table('master_address_types')->insert([
                    'client_id'  => null,
                    'branch_id'  => null,
                    'name'       => $name,
                    'status'     => 'Active',
                    'is_system'  => true,
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);
            }
        }
    }

    public function down(): void
    {
        // Demote — don't delete, since the rows may be referenced
        // from employee_addresses by address_type.
        DB::table('master_address_types')
            ->whereNull('client_id')
            ->whereNull('branch_id')
            ->whereIn(DB::raw('LOWER(name)'), ['registered office', 'warehouse', 'billing address'])
            ->update(['is_system' => false, 'updated_at' => now()]);
    }
};
