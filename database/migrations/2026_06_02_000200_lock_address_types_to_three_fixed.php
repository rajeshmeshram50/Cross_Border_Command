<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
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

        DB::table('master_address_types')
            ->where('is_system', false)
            ->delete();
    }

    public function down(): void
    {
        DB::table('master_address_types')
            ->whereNull('client_id')
            ->whereNull('branch_id')
            ->whereRaw('LOWER(name) = ?', ['registered address'])
            ->update(['name' => 'Registered Office', 'updated_at' => now()]);
    }
};
