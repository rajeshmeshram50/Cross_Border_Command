<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

class InventoryProductFlagSeeder extends Seeder
{
    public const DEFAULTS = [
        'Hazardous'  => 'Dangerous goods — handle and store under hazard rules',
        'Cold Chain' => 'Requires controlled cold temperature',
        'Fragile'    => 'Breakable — do not stack or drop',
    ];

    public function run(): void
    {
        $now  = now();
        $rows = [];

        foreach (self::DEFAULTS as $name => $purpose) {
            if ($this->platformHas($name)) continue;

            $rows[] = [
                'client_id'  => null,
                'branch_id'  => null,
                'flag_name'  => $name,
                'purpose'    => $purpose,
                'status'     => 1,
                'created_at' => $now,
                'updated_at' => $now,
            ];
        }

        if ($rows) {
            DB::table('inventory_product_flags')->insert($rows);
        }

        $this->command?->info('Inventory product flags: ' . count($rows) . ' platform default(s) added.');
    }

    private function platformHas(string $name): bool
    {
        return DB::table('inventory_product_flags')
            ->whereNull('client_id')
            ->whereRaw("lower(replace(flag_name, ' ', '')) = ?", [
                strtolower(str_replace(' ', '', $name)),
            ])
            ->exists();
    }
}
