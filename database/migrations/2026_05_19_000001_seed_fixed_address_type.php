<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Mark "Office" as a fixed system address type.
 *
 * Same pattern as `master_asset_categories` Laptop/Mobile pinning. The
 * seeded row is owned globally (client_id = null, branch_id = null) so
 * tenant scoping picks it up for every user, and `is_system = true` is
 * enforced in MasterController to block delete + name edits.
 *
 * Idempotent: a case-insensitive lookup on (client_id IS NULL, name)
 * upserts in place, so re-running migrations never duplicates the row
 * and never collides with a manually-created "Office" entry — it just
 * promotes the existing one to system status.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('master_address_types', function (Blueprint $table) {
            if (!Schema::hasColumn('master_address_types', 'is_system')) {
                $table->boolean('is_system')->default(false)->after('status');
            }
        });

        // Upsert the fixed global row.
        $exists = DB::table('master_address_types')
            ->whereNull('client_id')
            ->whereNull('branch_id')
            ->whereRaw('LOWER(name) = ?', ['office'])
            ->first();

        if ($exists) {
            DB::table('master_address_types')
                ->where('id', $exists->id)
                ->update([
                    'name'       => 'Office',
                    'status'     => 'Active',
                    'is_system'  => true,
                    'updated_at' => now(),
                ]);
        } else {
            DB::table('master_address_types')->insert([
                'client_id'  => null,
                'branch_id'  => null,
                'name'       => 'Office',
                'status'     => 'Active',
                'is_system'  => true,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }
    }

    public function down(): void
    {
        // Demote rather than delete — the row may be referenced
        // elsewhere (employee addresses use address_type by name).
        DB::table('master_address_types')
            ->whereNull('client_id')
            ->whereRaw('LOWER(name) = ?', ['office'])
            ->update(['is_system' => false]);

        Schema::table('master_address_types', function (Blueprint $table) {
            if (Schema::hasColumn('master_address_types', 'is_system')) {
                $table->dropColumn('is_system');
            }
        });
    }
};