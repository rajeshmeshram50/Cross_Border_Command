<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        foreach (['Warehouse', 'Billing Address'] as $name) {
            $exists = DB::table('master_address_types')
                ->whereNull('client_id')
                ->whereNull('branch_id')
                ->whereRaw('LOWER(name) = ?', [strtolower($name)])
                ->exists();

            if (!$exists) {
                DB::table('master_address_types')->insert([
                    'client_id'  => null,
                    'branch_id'  => null,
                    'name'       => $name,
                    'status'     => 'Active',
                    'is_system'  => true,
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);
            } else {
                DB::table('master_address_types')
                    ->whereNull('client_id')
                    ->whereNull('branch_id')
                    ->whereRaw('LOWER(name) = ?', [strtolower($name)])
                    ->update([
                        'name'       => $name,
                        'status'     => 'Active',
                        'is_system'  => true,
                        'updated_at' => now(),
                    ]);
            }
        }
    }

    public function down(): void
    {
    }
};
