<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * One-time cleanup: keep ONLY the three system-seeded address types
 * (Registered Office, Warehouse, Billing Address) at global scope.
 *
 * Removes every other globally-scoped entry that crept in during
 * earlier seeders / manual super-admin additions (Office, Branch
 * Address, Shipping Address, Factory, Godown, Corporate Office,
 * Correspondence, Export Yard, etc.) so the master list starts
 * clean and reflects only what the product needs.
 *
 * Per-tenant rows (client_id NOT NULL) are intentionally left alone
 * — clients/branches may have created their own address types and
 * we shouldn't wipe their data from a platform migration. Only the
 * shared global rows are cleaned up here.
 *
 * Idempotent: re-running has no effect because there's nothing left
 * to delete on the second pass (the surviving 3 rows have
 * is_system=true and are excluded from the WHERE clause).
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::table('master_address_types')
            ->whereNull('client_id')
            ->whereNull('branch_id')
            ->where('is_system', false)
            ->delete();
    }

    public function down(): void
    {
        // Cannot restore the deleted rows in the DOWN — the names are
        // lost. Leaving this empty is intentional. If you need them
        // back, re-add manually via the UI or a fresh seeder.
    }
};