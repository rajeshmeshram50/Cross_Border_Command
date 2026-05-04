<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Replace the legacy free-text asset slots on `employees` with FKs into
 * `master_assets`. The existing `laptop_asset_id` (varchar) and
 * `mobile_device` (varchar) columns stay — frontend stops writing to
 * them, but any historical text values remain readable.
 *
 *   laptop_master_asset_id   FK → master_assets.id (nullable)
 *   mobile_master_asset_id   FK → master_assets.id (nullable)
 *   other_master_asset_ids   JSON array of master_assets.id (nullable)
 *
 * EmployeeController enforces uniqueness across employees: no asset
 * can be selected by two different employees at once.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('employees', function (Blueprint $table) {
            $table->unsignedBigInteger('laptop_master_asset_id')->nullable()->after('laptop_asset_id');
            $table->unsignedBigInteger('mobile_master_asset_id')->nullable()->after('mobile_device');
            $table->json('other_master_asset_ids')->nullable()->after('other_assets');

            $table->index('laptop_master_asset_id', 'employees_laptop_asset_idx');
            $table->index('mobile_master_asset_id', 'employees_mobile_asset_idx');
        });
    }

    public function down(): void
    {
        Schema::table('employees', function (Blueprint $table) {
            $table->dropIndex('employees_laptop_asset_idx');
            $table->dropIndex('employees_mobile_asset_idx');
            $table->dropColumn([
                'laptop_master_asset_id',
                'mobile_master_asset_id',
                'other_master_asset_ids',
            ]);
        });
    }
};
