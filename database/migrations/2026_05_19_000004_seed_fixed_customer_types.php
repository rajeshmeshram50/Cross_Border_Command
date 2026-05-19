<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Mark Retailer and Wholesaler as the two fixed system "Customer
 * Consignee Type" master entries. Same pattern as the address_types
 * migration (2026_05_19_000002):
 *
 *   • Adds `is_system` boolean column to `master_customer_types`.
 *   • Upserts the two canonical rows at global scope (client_id NULL,
 *     branch_id NULL) with `is_system = true` — protected from delete
 *     and case-insensitive name re-creation by MasterController.
 *   • Cleans up every other globally-scoped non-system row so the
 *     master list starts clean. Per-tenant rows (client_id NOT NULL)
 *     are left alone — clients may have their own buyer types.
 *
 * Idempotent: case-insensitive lookups make re-runs safe.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('master_customer_types', function (Blueprint $table) {
            if (!Schema::hasColumn('master_customer_types', 'is_system')) {
                $table->boolean('is_system')->default(false)->after('status');
            }
        });

        // 1. Upsert the two fixed entries.
        $fixed = [
            ['name' => 'Retailer',   'gst_applicable' => 'Yes'],
            ['name' => 'Wholesaler', 'gst_applicable' => 'Yes'],
        ];
        foreach ($fixed as $row) {
            $existing = DB::table('master_customer_types')
                ->whereNull('client_id')
                ->whereNull('branch_id')
                ->whereRaw('LOWER(name) = ?', [strtolower($row['name'])])
                ->first();

            $payload = [
                'name'           => $row['name'],
                'gst_applicable' => $row['gst_applicable'],
                'status'         => 'Active',
                'is_system'      => true,
                'updated_at'     => now(),
            ];

            if ($existing) {
                DB::table('master_customer_types')
                    ->where('id', $existing->id)
                    ->update($payload);
            } else {
                DB::table('master_customer_types')->insert(array_merge($payload, [
                    'client_id'  => null,
                    'branch_id'  => null,
                    'created_at' => now(),
                ]));
            }
        }

        // 2. Clean up every other globally-scoped non-system row so
        //    only Retailer and Wholesaler remain at global scope.
        DB::table('master_customer_types')
            ->whereNull('client_id')
            ->whereNull('branch_id')
            ->where('is_system', false)
            ->delete();
    }

    public function down(): void
    {
        // Demote the two fixed rows rather than delete — customer
        // records may reference them by customer_type. Drop the
        // column too so the schema returns to its earlier state.
        DB::table('master_customer_types')
            ->whereNull('client_id')
            ->whereNull('branch_id')
            ->whereIn(DB::raw('LOWER(name)'), ['retailer', 'wholesaler'])
            ->update(['is_system' => false, 'updated_at' => now()]);

        Schema::table('master_customer_types', function (Blueprint $table) {
            if (Schema::hasColumn('master_customer_types', 'is_system')) {
                $table->dropColumn('is_system');
            }
        });
    }
};