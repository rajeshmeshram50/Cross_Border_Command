<?php

namespace Database\Seeders;

use App\Models\Client;
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
 * Per-tenant: one set of categories is created for every client. Idempotent
 * — a category already present (by name, case-insensitive) is skipped, and
 * DC-### codes continue from the highest existing suffix so it never
 * collides with categories an admin already added through the UI.
 *
 * Run standalone:
 *   php artisan db:seed --class=Database\\Seeders\\ClmTncCategorySeeder
 */
class ClmTncCategorySeeder extends Seeder
{
    /** name => short_code (≤ 12 chars). */
    private const CATEGORIES = [
        'International Quotation'        => 'IQ',
        'Domestic Quotation'            => 'DQ',
        'International Proforma Invoice' => 'IPI',
        'Domestic Proforma Invoice'     => 'DPI',
    ];

    public function run(): void
    {
        $clientIds = Client::query()->pluck('id');

        if ($clientIds->isEmpty()) {
            $this->command?->warn('ClmTncCategorySeeder: no clients found — nothing to seed.');
            return;
        }

        $created = 0;

        foreach ($clientIds as $clientId) {
            // Highest existing DC-### suffix for this client (DB-agnostic).
            $next = 0;
            foreach (ClmTncCategory::where('client_id', $clientId)->pluck('code') as $code) {
                if (preg_match('/^DC-(\d+)$/', (string) $code, $m)) {
                    $next = max($next, (int) $m[1]);
                }
            }

            foreach (self::CATEGORIES as $name => $short) {
                $exists = ClmTncCategory::where('client_id', $clientId)
                    ->whereRaw('LOWER(name) = ?', [mb_strtolower($name)])
                    ->exists();
                if ($exists) {
                    continue;
                }

                $next++;
                ClmTncCategory::create([
                    'client_id'  => $clientId,
                    'code'       => sprintf('DC-%03d', $next),
                    'short_code' => $short,
                    'name'       => $name,
                    'status'     => 'active',
                ]);
                $created++;
            }
        }

        $this->command?->info("ClmTncCategorySeeder: created {$created} category row(s) across {$clientIds->count()} client(s).");
    }
}
