<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Removes the "main branch" concept. All branches are now equal, isolated
 * peers — no branch is privileged as the head office / reference-data source.
 * The `is_main` column and its index are dropped from the branches table.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('branches', function (Blueprint $table) {
            // Drop the index first (named by Laravel's default convention),
            // then the column. Guarded so the migration is re-runnable.
            try {
                $table->dropIndex('branches_is_main_index');
            } catch (\Throwable $e) {
                // Index may already be gone (e.g. dropped with the column on
                // some drivers) — ignore.
            }
        });

        if (Schema::hasColumn('branches', 'is_main')) {
            Schema::table('branches', function (Blueprint $table) {
                $table->dropColumn('is_main');
            });
        }
    }

    public function down(): void
    {
        if (!Schema::hasColumn('branches', 'is_main')) {
            Schema::table('branches', function (Blueprint $table) {
                $table->boolean('is_main')->nullable()->default(false)->after('country');
                $table->index('is_main');
            });
        }
    }
};
