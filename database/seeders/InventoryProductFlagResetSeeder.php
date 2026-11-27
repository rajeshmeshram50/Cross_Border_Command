<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

class InventoryProductFlagResetSeeder extends Seeder
{
    public function run(): void
    {
        if (!app()->environment('local')) {
            $this->command?->error('Refused: this truncates inventory_product_flags and only runs on local.');
            return;
        }

        $inUse = DB::table('p2p_spi_box_items')
            ->whereNotNull('flags')
            ->pluck('flags')
            ->flatMap(fn ($v) => json_decode((string) $v, true) ?: [])
            ->unique();

        if ($inUse->isNotEmpty()) {
            $this->command?->error(
                'Refused: ' . $inUse->count() . ' flag id(s) are still on packed boxes (' .
                $inUse->sort()->implode(', ') . '). Truncating would strip the flags off those cartons.'
            );
            return;
        }

        $before = DB::table('inventory_product_flags')->count();

        DB::statement('TRUNCATE TABLE inventory_product_flags RESTART IDENTITY');

        (new InventoryProductFlagSeeder())->run();

        $after = DB::table('inventory_product_flags')
            ->orderBy('id')
            ->get(['id', 'flag_name', 'client_id', 'branch_id']);

        $this->command?->info("Removed {$before} row(s); seeded {$after->count()} platform default(s):");

        foreach ($after as $f) {
            $this->command?->line(sprintf(
                '  %-3s %-12s client=%s branch=%s',
                $f->id,
                $f->flag_name,
                $f->client_id ?? 'null',
                $f->branch_id ?? 'null',
            ));
        }
    }
}
