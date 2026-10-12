<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

/**
 * Inventory · Wipe the product flags and lay the platform defaults down fresh.
 *
 * DESTRUCTIVE, and separate from InventoryProductFlagSeeder for that reason:
 * that one only ever ADDS what is missing and is safe to run anywhere, while
 * this empties the table first. Two names, so nobody reaches for the wrong one
 * by habit.
 *
 * What it is for: testing the platform-level seed from a clean slate, where
 * the per-branch rows from the earlier approach are still lying around and the
 * ids need to start at 1 again so "Cold Chain is id 1 everywhere" is actually
 * visible.
 *
 * TRUNCATE ... RESTART IDENTITY, not DELETE: a plain delete leaves the
 * sequence where it was, so the "fresh" rows would come back as 10, 11, 12 and
 * the thing being tested would be hidden by the thing that caused the bug.
 *
 * REFUSES OUTSIDE LOCAL. Box items store flag ids in a json column with no
 * foreign key to stop this, so emptying the table on a real database would
 * leave every packed carton pointing at flags that no longer exist — and
 * nothing would complain. Local only, and it still checks first.
 *
 *   php artisan db:seed --class=InventoryProductFlagResetSeeder
 */
class InventoryProductFlagResetSeeder extends Seeder
{
    public function run(): void
    {
        if (!app()->environment('local')) {
            $this->command?->error('Refused: this truncates inventory_product_flags and only runs on local.');
            return;
        }

        /* Boxes point at flag ids through a json column, so nothing in the
           database would stop this leaving them dangling. Check by hand. */
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
