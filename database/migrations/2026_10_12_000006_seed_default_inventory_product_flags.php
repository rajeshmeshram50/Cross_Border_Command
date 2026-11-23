<?php

use Database\Seeders\InventoryProductFlagSeeder;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        (new InventoryProductFlagSeeder())->run();
    }

    public function down(): void
    {
        foreach (InventoryProductFlagSeeder::DEFAULTS as $name => $purpose) {
            DB::table('inventory_product_flags')
                ->whereNull('client_id')
                ->where('flag_name', $name)
                ->where('purpose', $purpose)
                ->where('status', 1)
                ->delete();
        }
    }
};
