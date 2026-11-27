<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('master_address_types', function (Blueprint $table) {
            if (!Schema::hasColumn('master_address_types', 'is_system')) {
                $table->boolean('is_system')->default(false)->after('status');
            }
        });

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
