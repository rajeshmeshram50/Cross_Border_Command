<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Makes clm_tnc_categories.client_id NULLABLE so the four standard T&C
 * document categories (International/Domestic × Quotation/Proforma Invoice)
 * can live as a single GLOBAL set (client_id = NULL) visible to every
 * tenant, instead of being duplicated per client. A client's own custom
 * categories continue to carry their client_id as before.
 *
 * It ALSO converts existing data so a plain `php artisan migrate` on an
 * environment where the old per-tenant seeder already ran (e.g. live) is
 * self-sufficient: the per-client copies of the four standard names are
 * removed and one global set is inserted. The query builder is used (not
 * the Eloquent model) so this migration stays valid even if the model
 * changes later. Mirrors ClmTncCategorySeeder, which remains the canonical
 * idempotent source for fresh installs.
 */
return new class extends Migration
{
    /** name => short_code (≤ 12 chars). */
    private const CATEGORIES = [
        'International Quotation'        => 'IQ',
        'Domestic Quotation'            => 'DQ',
        'International Proforma Invoice' => 'IPI',
        'Domestic Proforma Invoice'     => 'DPI',
    ];

    public function up(): void
    {
        // 1) Schema: drop the NOT NULL on client_id (keep the FK).
        Schema::table('clm_tnc_categories', function (Blueprint $table) {
            $table->dropForeign(['client_id']);
        });

        Schema::table('clm_tnc_categories', function (Blueprint $table) {
            $table->unsignedBigInteger('client_id')->nullable()->change();
            $table->foreign('client_id')->references('id')->on('clients')->cascadeOnDelete();
        });

        // 2) Data: collapse the per-client copies into one global set.
        $names = array_keys(self::CATEGORIES);

        // Remove leftover per-client copies of these standard names.
        DB::table('clm_tnc_categories')
            ->whereNotNull('client_id')
            ->where(function ($q) use ($names) {
                foreach ($names as $name) {
                    $q->orWhereRaw('LOWER(name) = ?', [mb_strtolower($name)]);
                }
            })
            ->delete();

        // Next global DC-### suffix (continue past any existing global rows).
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
        // Global rows can't satisfy the NOT NULL constraint — drop them first.
        DB::table('clm_tnc_categories')->whereNull('client_id')->delete();

        Schema::table('clm_tnc_categories', function (Blueprint $table) {
            $table->dropForeign(['client_id']);
        });

        Schema::table('clm_tnc_categories', function (Blueprint $table) {
            $table->unsignedBigInteger('client_id')->nullable(false)->change();
            $table->foreign('client_id')->references('id')->on('clients')->cascadeOnDelete();
        });
    }
};
