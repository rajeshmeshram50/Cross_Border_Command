<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

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
