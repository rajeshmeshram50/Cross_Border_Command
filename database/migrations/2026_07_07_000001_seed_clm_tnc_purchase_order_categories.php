<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Seeds the two standard Purchase Order T&C document categories as a single
 * GLOBAL set (client_id = NULL) so they exist on every environment after a
 * plain `php artisan migrate` — exactly like the Quotation/Proforma Invoice
 * categories are seeded by 2026_06_10_000001_make_clm_tnc_categories_client_id_nullable.
 *
 *   • International Purchase Order  (IPO)
 *   • Domestic Purchase Order      (DPO)
 *
 * Previously these lived ONLY in the standalone ClmTncPurchaseOrderSeeder,
 * which never runs automatically — so fresh installs were missing DC-005/006
 * and the PO T&C auto-fetch had nothing to match. This migration makes them
 * self-sufficient. It mirrors ClmTncPurchaseOrderSeeder (which remains the
 * canonical idempotent source) and uses the query builder, not Eloquent, so
 * it stays valid even if the model changes.
 *
 * Idempotent: a global category already present (by name, case-insensitive)
 * is skipped, and DC-### codes continue from the highest existing global
 * suffix (so it lands on DC-005/006 after the four Quotation/PI rows). Any
 * leftover per-client copies of these two names are removed first.
 */
return new class extends Migration
{
    /** name => short_code (≤ 12 chars). */
    private const CATEGORIES = [
        'International Purchase Order' => 'IPO',
        'Domestic Purchase Order'     => 'DPO',
    ];

    public function up(): void
    {
        $names = array_keys(self::CATEGORIES);

        // Remove leftover per-client copies of these standard names — they're
        // now owned by the global set.
        DB::table('clm_tnc_categories')
            ->whereNotNull('client_id')
            ->where(function ($q) use ($names) {
                foreach ($names as $name) {
                    $q->orWhereRaw('LOWER(name) = ?', [mb_strtolower($name)]);
                }
            })
            ->delete();

        // Next global DC-### suffix (continue past any existing global rows,
        // i.e. the four Quotation/PI categories → PO lands on DC-005/006).
        $next = 0;
        foreach (DB::table('clm_tnc_categories')->whereNull('client_id')->pluck('code') as $code) {
            if (preg_match('/^DC-(\d+)$/', (string) $code, $m)) {
                $next = max($next, (int) $m[1]);
            }
        }

        $now = now();
        foreach (self::CATEGORIES as $name => $short) {
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

    public function down(): void
    {
        $names = array_keys(self::CATEGORIES);

        DB::table('clm_tnc_categories')
            ->whereNull('client_id')
            ->where(function ($q) use ($names) {
                foreach ($names as $name) {
                    $q->orWhereRaw('LOWER(name) = ?', [mb_strtolower($name)]);
                }
            })
            ->delete();
    }
};
