<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    private array $fixed = ['Registered Office', 'Warehouse', 'Branch'];

    public function up(): void
    {
        $now = now();

        DB::table('master_address_types')
            ->whereNull('client_id')
            ->whereNull('branch_id')
            ->whereRaw('LOWER(name) = ?', ['registered address'])
            ->update(['name' => 'Registered Office', 'is_system' => true, 'status' => 'Active', 'updated_at' => $now]);

        foreach ($this->fixed as $name) {
            $row = DB::table('master_address_types')
                ->whereNull('client_id')
                ->whereNull('branch_id')
                ->whereRaw('LOWER(name) = ?', [strtolower($name)])
                ->first();

            if ($row) {
                DB::table('master_address_types')->where('id', $row->id)->update([
                    'name'       => $name,
                    'is_system'  => true,
                    'status'     => 'Active',
                    'updated_at' => $now,
                ]);
            } else {
                DB::table('master_address_types')->insert([
                    'client_id'  => null,
                    'branch_id'  => null,
                    'name'       => $name,
                    'status'     => 'Active',
                    'is_system'  => true,
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);
            }
        }

        DB::table('master_address_types')
            ->whereRaw('LOWER(name) NOT IN (?, ?, ?)', ['registered office', 'warehouse', 'branch'])
            ->delete();
    }

    public function down(): void
    {
    }
};
