<?php

namespace Database\Seeders;

use App\Models\ClmTncCategory;
use Illuminate\Database\Seeder;

/**
 * Seeds the two Purchase Order T&C Document Categories:
 *
 *   • International Purchase Order
 *   • Domestic Purchase Order
 *
 * GLOBAL, not per-tenant: created with client_id = NULL so they show for
 * every client/branch (ClmTncController::categoriesIndex merges global +
 * tenant rows). Mirrors the pattern in ClmTncCategorySeeder.
 *
 * Idempotent — a global category already present (by name, case-insensitive)
 * is skipped, and DC-### codes continue from the highest existing global
 * suffix. Any leftover PER-CLIENT copies of these two names (from earlier
 * per-tenant seeding) are removed so the list doesn't show duplicates.
 *
 * Run standalone:
 *   php artisan db:seed --class=ClmTncPurchaseOrderSeeder
 */
class ClmTncPurchaseOrderSeeder extends Seeder
{
    /** name => short_code (≤ 12 chars). */
    private const CATEGORIES = [
        'International Purchase Order' => 'IPO',
        'Domestic Purchase Order'     => 'DPO',
    ];

    public function run(): void
    {
        $standardNames = array_map('mb_strtolower', array_keys(self::CATEGORIES));

        // Drop per-client copies of these names left over from any earlier
        // per-tenant seeding — they're now owned by the global set.
        $dupes = ClmTncCategory::whereNotNull('client_id')->get()
            ->filter(fn ($c) => in_array(mb_strtolower((string) $c->name), $standardNames, true));
        $removed = $dupes->count();
        $dupes->each->delete();

        // Highest existing global DC-### suffix (DB-agnostic).
        $next = 0;
        foreach (ClmTncCategory::whereNull('client_id')->pluck('code') as $code) {
            if (preg_match('/^DC-(\d+)$/', (string) $code, $m)) {
                $next = max($next, (int) $m[1]);
            }
        }

        $created = 0;
        foreach (self::CATEGORIES as $name => $short) {
            $exists = ClmTncCategory::whereNull('client_id')
                ->whereRaw('LOWER(name) = ?', [mb_strtolower($name)])
                ->exists();
            if ($exists) {
                continue;
            }

            $next++;
            ClmTncCategory::create([
                'client_id'  => null,
                'code'       => sprintf('DC-%03d', $next),
                'short_code' => $short,
                'name'       => $name,
                'status'     => 'active',
            ]);
            $created++;
        }

        $this->command?->info("ClmTncPurchaseOrderSeeder: created {$created} global category row(s); removed {$removed} per-client duplicate(s).");
    }
}
