<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('master_asset_categories', function (Blueprint $table) {
            if (!Schema::hasColumn('master_asset_categories', 'is_system')) {
                $table->boolean('is_system')->default(false)->after('status');
            }
        });

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
