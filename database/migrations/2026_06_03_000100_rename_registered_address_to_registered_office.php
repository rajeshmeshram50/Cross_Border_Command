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
            ->whereRaw('LOWER(name) = ?', ['registered address'])
            ->update([
                'name'       => 'Registered Office',
                'is_system'  => true,
                'status'     => 'Active',
                'updated_at' => now(),
            ]);
    }

    public function down(): void
    {
        DB::table('master_address_types')
            ->whereNull('client_id')
            ->whereNull('branch_id')
            ->whereRaw('LOWER(name) = ?', ['registered office'])
            ->update([
                'name'       => 'Registered Address',
                'updated_at' => now(),
            ]);
    }
};
