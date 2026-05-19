<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Mark Standard and VIP as the two fixed system "Customer
 * Classification" entries.
 *
 * Same pattern as address_types / customer_types / risk_levels:
 *   • Adds `is_system` boolean column to `master_customer_classifications`.
 *   • Upserts the two canonical rows at global scope with
 *     `is_system = true`. Standard = default new-customer tier.
 *     VIP = top tier with the largest credit + longest terms.
 *   • Cleans up every other globally-scoped non-system row so the
 *     list starts clean. Per-tenant rows are left alone.
 *
 * Idempotent — case-insensitive lookup, re-runs are safe.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('master_customer_classifications', function (Blueprint $table) {
            if (!Schema::hasColumn('master_customer_classifications', 'is_system')) {
                $table->boolean('is_system')->default(false)->after('status');
            }
        });

        // 1. Upsert the two fixed entries.
        $fixed = [
            [
                'name'          => 'Standard',
                'credit_limit'  => 500000,
                'payment_terms' => 30,
            ],
            [
                'name'          => 'VIP',
                'credit_limit'  => 10000000,
                'payment_terms' => 60,
            ],
        ];
        foreach ($fixed as $row) {
            $existing = DB::table('master_customer_classifications')
                ->whereNull('client_id')
                ->whereNull('branch_id')
                ->whereRaw('LOWER(name) = ?', [strtolower($row['name'])])
                ->first();

            $payload = [
                'name'          => $row['name'],
                'credit_limit'  => $row['credit_limit'],
                'payment_terms' => $row['payment_terms'],
                'status'        => 'Active',
                'is_system'     => true,
                'updated_at'    => now(),
            ];

            if ($existing) {
                DB::table('master_customer_classifications')
                    ->where('id', $existing->id)
                    ->update($payload);
            } else {
                DB::table('master_customer_classifications')->insert(array_merge($payload, [
                    'client_id'  => null,
                    'branch_id'  => null,
                    'created_at' => now(),
                ]));
            }
        }

        // 2. Clean up every other globally-scoped non-system row.
        DB::table('master_customer_classifications')
            ->whereNull('client_id')
            ->whereNull('branch_id')
            ->where('is_system', false)
            ->delete();
    }

    public function down(): void
    {
        DB::table('master_customer_classifications')
            ->whereNull('client_id')
            ->whereNull('branch_id')
            ->whereIn(DB::raw('LOWER(name)'), ['standard', 'vip'])
            ->update(['is_system' => false, 'updated_at' => now()]);

        Schema::table('master_customer_classifications', function (Blueprint $table) {
            if (Schema::hasColumn('master_customer_classifications', 'is_system')) {
                $table->dropColumn('is_system');
            }
        });
    }
};