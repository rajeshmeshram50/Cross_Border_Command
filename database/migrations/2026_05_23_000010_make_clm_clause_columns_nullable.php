<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Alter migration — for installs where the original
 * 2026_05_22_000130_create_clm_clause_types_table and
 * 2026_05_22_000140_create_clm_clause_library_table migrations have
 * already run with the NOT NULL columns.
 *
 * The redesigned Clause Library frontend dropped:
 *   - `description` from the Clause Type modal (kept on schema, now optional)
 *   - `party` from the Add Clause modal (kept on schema, now optional)
 *
 * Fresh installs pick the nullable definition up directly from the
 * original migrations (also patched). This migration is the safe path
 * for installs already past those migrations: it switches the columns
 * to nullable without touching existing data.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('clm_clause_types')) {
            Schema::table('clm_clause_types', function (Blueprint $table) {
                $table->string('description', 500)->nullable()->change();
            });
        }
        if (Schema::hasTable('clm_clause_library')) {
            Schema::table('clm_clause_library', function (Blueprint $table) {
                $table->string('party', 255)->nullable()->change();
            });
        }
    }

    public function down(): void
    {
        /* Roll-back leaves the columns nullable rather than restoring
         * NOT NULL — flipping NOT NULL back would fail on any rows
         * that have NULL values in the meantime. The dev can restore
         * the constraint manually if they really need it. */
    }
};
