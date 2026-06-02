<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Lock the Address Types master to EXACTLY three fixed entries:
 *
 *   1. Warehouse
 *   2. Registered Address    (renamed from "Registered Office")
 *   3. Billing Address
 *
 * Rationale: product decision — address types should be a fixed
 * vocabulary across every tenant, so addresses always classify cleanly.
 * Allowing per-tenant custom types led to drift (Workplace, Office,
 * Igc, Branch Address, etc.) that broke downstream reporting.
 *
 * This migration:
 *   1. Renames the global system row "Registered Office" → "Registered Address"
 *      to match the canonical naming.
 *   2. Deletes all non-system rows (both global and tenant-scoped) so
 *      only the three fixed rows survive.
 *
 * NOTE on FK safety:
 *   Address `type` columns on consignee/customer/vendor/employee_addresses
 *   tables are stored as plain strings (not FK to master_address_types).
 *   Deleting master rows does not break referential integrity — existing
 *   addresses keep their string value. Any orphan address-type strings
 *   (e.g. "Workplace") still display fine, they just can't be reused on
 *   new addresses going forward (UI dropdown is restricted to the 3 fixed).
 */
return new class extends Migration
{
    public function up(): void
    {
        // ── 1. Rename "Registered Office" → "Registered Address" on the
        //       global system row (case-insensitive lookup so prior
        //       canonical-casing variations are caught).
        DB::table('master_address_types')
            ->whereNull('client_id')
            ->whereNull('branch_id')
            ->whereRaw('LOWER(name) = ?', ['registered office'])
            ->update([
                'name'       => 'Registered Address',
                'is_system'  => true,
                'status'     => 'Active',
                'updated_at' => now(),
            ]);

        // ── 2. Ensure the row exists even if a fresh DB never ran the
        //       prior seed (idempotent guarantee).
        $exists = DB::table('master_address_types')
            ->whereNull('client_id')
            ->whereNull('branch_id')
            ->whereRaw('LOWER(name) = ?', ['registered address'])
            ->exists();
        if (!$exists) {
            DB::table('master_address_types')->insert([
                'client_id'  => null,
                'branch_id'  => null,
                'name'       => 'Registered Address',
                'status'     => 'Active',
                'is_system'  => true,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }

        // ── 3. Re-confirm Warehouse + Billing Address are pinned system.
        foreach (['Warehouse', 'Billing Address'] as $name) {
            DB::table('master_address_types')
                ->whereNull('client_id')
                ->whereNull('branch_id')
                ->whereRaw('LOWER(name) = ?', [strtolower($name)])
                ->update([
                    'name'       => $name,
                    'is_system'  => true,
                    'status'     => 'Active',
                    'updated_at' => now(),
                ]);
        }

        // ── 4. Nuke everything else — both global non-system rows AND
        //       every per-tenant row. The user explicitly asked for
        //       "only these 3 should exist" across the whole platform.
        DB::table('master_address_types')
            ->where('is_system', false)
            ->delete();
    }

    public function down(): void
    {
        // Restore prior name. The deleted tenant rows can't be recovered
        // from a down migration (their names are lost); intentionally
        // leaving that out — re-add manually if needed.
        DB::table('master_address_types')
            ->whereNull('client_id')
            ->whereNull('branch_id')
            ->whereRaw('LOWER(name) = ?', ['registered address'])
            ->update(['name' => 'Registered Office', 'updated_at' => now()]);
    }
};
