<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Mark "Laptop" and "Mobile" as fixed system categories.
 *
 * Stage 1 Step 3 (Assets & Security) of employee onboarding pulls its
 * laptop / mobile dropdowns from these two categories specifically.
 * They have to exist for every tenant and must not be deletable —
 * otherwise the dropdown would silently break.
 *
 * Seeded as global rows (client_id = null, branch_id = null) so the
 * tenant-scoped applyScope() picks them up for every user without a
 * per-client backfill, and `is_system = true` is enforced in
 * MasterController to block delete + name edits.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('master_asset_categories', function (Blueprint $table) {
            if (!Schema::hasColumn('master_asset_categories', 'is_system')) {
                $table->boolean('is_system')->default(false)->after('status');
            }
        });

        // Seed/upsert the two fixed categories as global rows.
        foreach (['Laptop', 'Mobile'] as $name) {
            $exists = DB::table('master_asset_categories')
                ->whereNull('client_id')
                ->whereNull('branch_id')
                ->whereRaw('LOWER(name) = ?', [strtolower($name)])
                ->first();

            if ($exists) {
                DB::table('master_asset_categories')
                    ->where('id', $exists->id)
                    ->update(['name' => $name, 'is_system' => true, 'status' => 'Active', 'updated_at' => now()]);
            } else {
                DB::table('master_asset_categories')->insert([
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
        // Demote the seeded rows but don't delete — they may already
        // be referenced by master_assets via asset_type_id.
        DB::table('master_asset_categories')
            ->whereNull('client_id')
            ->whereIn(DB::raw('LOWER(name)'), ['laptop', 'mobile'])
            ->update(['is_system' => false]);

        Schema::table('master_asset_categories', function (Blueprint $table) {
            if (Schema::hasColumn('master_asset_categories', 'is_system')) {
                $table->dropColumn('is_system');
            }
        });
    }
};
