<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

/**
 * Inventory · The three product flags the SPI packing screen draws.
 *
 * Stage 03 shows Hazardous, Cold Chain and Fragile as built-in chips and then
 * resolves each to a row in inventory_product_flags BY NAME. Where the master
 * has no such row the chip resolves to nothing: it appears selected, sends no
 * id, and Cold Chain in particular loses its meaning — the temperature guard
 * has no flag to find, so a range is refused on a box the packer believes they
 * marked.
 *
 * Seeded ONCE, at platform level — client_id and branch_id both null — rather
 * than copied into every branch. Three reasons, and the first is the one that
 * matters:
 *
 *   · ONE ID EVERYWHERE. Per-branch copies give "Cold Chain" a different id in
 *     every branch, and a box stores the id. A screen that fetched the flags
 *     for the wrong branch then wrote an id the box's own branch has never
 *     heard of, and the cold-chain check could not find it.
 *   · A NEW BRANCH IS ALREADY DONE. Per-branch seeding leaves every branch
 *     created afterwards with an empty master until somebody re-runs this.
 *   · They are the same three flags for everyone. A per-tenant copy of a
 *     constant is a copy that can drift.
 *
 * Tenants SEE these (the list and options include platform rows) but cannot
 * edit or delete them — the write scope does not reach a null client_id, so
 * one tenant cannot rename or switch off a flag everyone else relies on. A
 * tenant wanting something different adds a flag of its own.
 *
 * Idempotent on the normalised name, so running it again adds nothing.
 *
 *   php artisan db:seed --class=InventoryProductFlagSeeder
 */
class InventoryProductFlagSeeder extends Seeder
{
    /** name => purpose, in the order the chips appear on screen. */
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
                // Owned by nobody: that is what makes it shared.
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

    /**
     * Spaces squeezed and case folded, the same normalisation the cold-chain
     * lookup uses — so "ColdChain" already seeded is not given a second row
     * called "Cold Chain" that the guard would then have to choose between.
     */
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
