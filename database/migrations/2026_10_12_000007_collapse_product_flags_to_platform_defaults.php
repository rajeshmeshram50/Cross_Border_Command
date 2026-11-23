<?php

use Database\Seeders\InventoryProductFlagSeeder;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        (new InventoryProductFlagSeeder())->run();

        $inUse = DB::table('p2p_spi_box_items')
            ->whereNotNull('flags')
            ->pluck('flags')
            ->flatMap(fn ($v) => json_decode((string) $v, true) ?: [])
            ->map(fn ($v) => (int) $v)
            ->unique()
            ->all();

        foreach (InventoryProductFlagSeeder::DEFAULTS as $name => $purpose) {
            DB::table('inventory_product_flags')
                ->whereNotNull('client_id')
                ->where('flag_name', $name)
                ->where('purpose', $purpose)
                ->where('status', 1)
                ->when($inUse, fn ($q) => $q->whereNotIn('id', $inUse))
                ->delete();
        }
    }

    public function down(): void
    {
    }
};
