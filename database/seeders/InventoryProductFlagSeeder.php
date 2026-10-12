<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

/**
 * Inventory · The three product flags the SPI packing screen draws.
 *
 * Stage 03 shows Hazardous, Cold Chain and Fragile as built-in chips and then
 * resolves each to a row in inventory_product_flags BY NAME. On a branch whose
 * master is empty the chip resolves to nothing: it appears selected, sends no
 * id, and Cold Chain in particular loses its meaning — the temperature guard
 * has no flag to find, so a range is refused on a box the packer believes they
 * marked.
 *
 * Seeded per BRANCH, because the master is branch-scoped and each branch's
 * packers pick from their own list.
 *
 * Idempotent on (client, branch, normalised name): running it again adds
 * nothing, and a branch that already defined its own "Cold Chain" keeps the
 * row it has — including its id, which packed box items already point at.
 * That matters more than tidiness: rewriting those rows would strip the flag
 * off cartons that are already packed.
 *
 * Re-run after adding a branch:
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

        $branches = DB::table('branches')->whereNull('deleted_at')->get(['id', 'client_id']);

        foreach ($branches as $b) {
            foreach (self::DEFAULTS as $name => $purpose) {
                if ($this->alreadyHas((int) $b->client_id, (int) $b->id, $name)) {
                    continue;
                }

                $rows[] = [
                    'client_id'  => $b->client_id,
                    'branch_id'  => $b->id,
                    'flag_name'  => $name,
                    'purpose'    => $purpose,
                    'status'     => 1,
                    'created_at' => $now,
                    'updated_at' => $now,
                ];
            }
        }

        if ($rows) {
            DB::table('inventory_product_flags')->insert($rows);
        }

        $this->command?->info(
            'Inventory product flags: ' . count($rows) . ' added across ' . $branches->count() . ' branch(es).'
        );
    }

    /**
     * Spaces squeezed and case folded, the same normalisation the cold-chain
     * lookup uses — so a branch holding "ColdChain" is not given a second row
     * called "Cold Chain" that the guard would then have to choose between.
     */
    private function alreadyHas(int $clientId, int $branchId, string $name): bool
    {
        return DB::table('inventory_product_flags')
            ->where('client_id', $clientId)
            ->where('branch_id', $branchId)
            ->whereRaw("lower(replace(flag_name, ' ', '')) = ?", [
                strtolower(str_replace(' ', '', $name)),
            ])
            ->exists();
    }
}
