<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Merge the two Quotation T&C categories into their Proforma Invoice
 * counterparts. Quotation and Proforma Invoice now SHARE one T&C set — a
 * Quotation PDF reuses the "… Proforma Invoice" categories (see
 * SalesPdfController::fetchSegmentTncs, which now always matches on
 * "proforma invoice"). So the two Quotation categories are retired:
 *
 *   International Quotation  →  International Proforma Invoice
 *   Domestic Quotation       →  Domestic Proforma Invoice
 *
 * clm_tnc_library links its category by NAME (no FK — see the library table
 * migration), so "using the PI id" here means re-filing each library row's
 * `category` name onto the matching PI category BEFORE the Quotation category
 * rows are deleted, so no authored T&C is orphaned.
 *
 * Idempotent: re-file is a no-op once done; the category delete matches by
 * name case-insensitively (global + any per-client copies).
 */
return new class extends Migration
{
    /** Retired Quotation name => its Proforma Invoice replacement. */
    private const MERGE = [
        'international quotation' => 'International Proforma Invoice',
        'domestic quotation'     => 'Domestic Proforma Invoice',
    ];

    public function up(): void
    {
        // 1. Re-file existing library T&Cs off the Quotation categories onto
        //    the matching Proforma Invoice category (case-insensitive match).
        foreach (self::MERGE as $fromLc => $to) {
            DB::table('clm_tnc_library')
                ->whereRaw('LOWER(category) = ?', [$fromLc])
                ->update(['category' => $to, 'updated_at' => now()]);
        }

        // 2. Delete the retired Quotation categories themselves (global rows
        //    AND any leftover per-client copies).
        DB::table('clm_tnc_categories')
            ->where(function ($q) {
                foreach (array_keys(self::MERGE) as $lc) {
                    $q->orWhereRaw('LOWER(name) = ?', [$lc]);
                }
            })
            ->delete();
    }

    /**
     * Best-effort reverse: recreate the two Quotation categories as globals so
     * the list shows four again. The library re-file is NOT reversed — we can't
     * tell which PI rows were originally Quotation — so those stay on PI.
     */
    public function down(): void
    {
        $names = ['International Quotation' => 'IQ', 'Domestic Quotation' => 'DQ'];

        // Continue the DC-### sequence past the highest existing global code.
        $next = 0;
        foreach (DB::table('clm_tnc_categories')->whereNull('client_id')->pluck('code') as $code) {
            if (preg_match('/^DC-(\d+)$/', (string) $code, $m)) {
                $next = max($next, (int) $m[1]);
            }
        }

        $now = now();
        foreach ($names as $name => $short) {
            $exists = DB::table('clm_tnc_categories')
                ->whereNull('client_id')
                ->whereRaw('LOWER(name) = ?', [mb_strtolower($name)])
                ->exists();
            if ($exists) {
                continue;
            }
            $next++;
            DB::table('clm_tnc_categories')->insert([
                'client_id'  => null,
                'code'       => sprintf('DC-%03d', $next),
                'short_code' => $short,
                'name'       => $name,
                'status'     => 'active',
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        }
    }
};
