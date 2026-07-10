<?php

namespace Database\Seeders;

use App\Models\ClmTncCategory;
use Illuminate\Database\Seeder;

/**
 * Seeds the four standard T&C Document Categories used by the PDF
 * auto-fetch (SalesPdfController::fetchSegmentTncs):
 *
 *   <Document Type> <Document Kind>
 *     • International Quotation
 *     • Domestic Quotation
 *     • International Proforma Invoice
 *     • Domestic Proforma Invoice
 *
 * The matcher looks for a category whose name CONTAINS the document-type
 * word (International / Domestic) AND the document-kind words
 * (Quotation / Proforma Invoice), so these exact names make the link work.
 *
 * GLOBAL, not per-tenant: a single shared set is created with
 * client_id = NULL so it shows for every client/branch (see
 * ClmTncController::categoriesIndex, which merges global + tenant rows).
 * Idempotent — a global category already present (by name, case-insensitive)
 * is skipped, and DC-### codes continue from the highest existing global
 * suffix. Any leftover PER-CLIENT copies of these four names (from the old
 * per-tenant seeding) are removed so the list doesn't show duplicates.
 *
 * Run standalone:
 *   php artisan db:seed --class=Database\\Seeders\\ClmTncCategorySeeder
 */
class ClmTncCategorySeeder extends Seeder
{
    /** name => short_code (≤ 12 chars).
     *  Quotation and Proforma Invoice now SHARE one T&C set, so only the two
     *  Proforma Invoice categories are seeded — a Quotation PDF reuses them
     *  (see SalesPdfController::fetchSegmentTncs). The retired Quotation
     *  categories are removed + their T&Cs re-filed onto these by migration
     *  2026_07_09_000001_merge_tnc_quotation_into_proforma_invoice. */
    private const CATEGORIES = [
        'International Proforma Invoice' => 'IPI',
        'Domestic Proforma Invoice'     => 'DPI',
        // Purchase Order categories live in their own ClmTncPurchaseOrderSeeder.
    ];

    public function run(): void
    {
        $standardNames = array_map('mb_strtolower', array_keys(self::CATEGORIES));

        // Drop per-client copies of these standard names left over from the
        // old per-tenant seeding — they're now owned by the global set.
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

        $this->command?->info("ClmTncCategorySeeder: created {$created} global category row(s); removed {$removed} per-client duplicate(s).");
    }
}
