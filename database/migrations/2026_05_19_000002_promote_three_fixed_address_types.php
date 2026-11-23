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
            ->whereRaw('LOWER(name) = ?', ['office'])
            ->update(['is_system' => false, 'updated_at' => now()]);

        $fixed = ['Registered Office', 'Warehouse', 'Billing Address'];
        foreach ($fixed as $name) {
            $existing = DB::table('master_address_types')
                ->whereNull('client_id')
                ->whereNull('branch_id')
                ->whereRaw('LOWER(name) = ?', [strtolower($name)])
                ->first();

            if ($existing) {
                DB::table('master_address_types')
                    ->where('id', $existing->id)
                    ->update([
                        'name'       => $name,
                        'status'     => 'Active',
                        'is_system'  => true,
                        'updated_at' => now(),
                    ]);
            } else {
                DB::table('master_address_types')->insert([
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
        DB::table('master_address_types')
            ->whereNull('client_id')
            ->whereNull('branch_id')
            ->whereIn(DB::raw('LOWER(name)'), ['registered office', 'warehouse', 'billing address'])
            ->update(['is_system' => false, 'updated_at' => now()]);
    }
};
