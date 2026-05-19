<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Mark Low and High as the two fixed system "Risk Level" entries.
 *
 * Same pattern as address_types / customer_types:
 *   • Adds `is_system` boolean column to `master_risk_levels`.
 *   • Upserts the two canonical rows at global scope with
 *     `is_system = true` — protected from delete + name edit and
 *     blocks any case-insensitive duplicate from being added under
 *     any tenant scope.
 *   • Cleans up every other globally-scoped non-system row so the
 *     list starts clean. Per-tenant rows are left alone.
 *
 * Idempotent: case-insensitive name lookup, re-runs are safe.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('master_risk_levels', function (Blueprint $table) {
            if (!Schema::hasColumn('master_risk_levels', 'is_system')) {
                $table->boolean('is_system')->default(false)->after('status');
            }
        });

        // 1. Upsert the two fixed entries.
        $fixed = [
            [
                'name'            => 'Low',
                'description'     => 'Minimal risk — standard processing',
                'action_required' => 'None',
            ],
            [
                'name'            => 'High',
                'description'     => 'Significant risk — needs review',
                'action_required' => 'Escalate to manager',
            ],
        ];
        foreach ($fixed as $row) {
            $existing = DB::table('master_risk_levels')
                ->whereNull('client_id')
                ->whereNull('branch_id')
                ->whereRaw('LOWER(name) = ?', [strtolower($row['name'])])
                ->first();

            $payload = [
                'name'            => $row['name'],
                'description'     => $row['description'],
                'action_required' => $row['action_required'],
                'status'          => 'Active',
                'is_system'       => true,
                'updated_at'      => now(),
            ];

            if ($existing) {
                DB::table('master_risk_levels')
                    ->where('id', $existing->id)
                    ->update($payload);
            } else {
                DB::table('master_risk_levels')->insert(array_merge($payload, [
                    'client_id'  => null,
                    'branch_id'  => null,
                    'created_at' => now(),
                ]));
            }
        }

        // 2. Clean up every other globally-scoped non-system row.
        DB::table('master_risk_levels')
            ->whereNull('client_id')
            ->whereNull('branch_id')
            ->where('is_system', false)
            ->delete();
    }

    public function down(): void
    {
        DB::table('master_risk_levels')
            ->whereNull('client_id')
            ->whereNull('branch_id')
            ->whereIn(DB::raw('LOWER(name)'), ['low', 'high'])
            ->update(['is_system' => false, 'updated_at' => now()]);

        Schema::table('master_risk_levels', function (Blueprint $table) {
            if (Schema::hasColumn('master_risk_levels', 'is_system')) {
                $table->dropColumn('is_system');
            }
        });
    }
};