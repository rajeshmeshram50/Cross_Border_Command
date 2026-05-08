<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\DB;

/**
 * Add JSON column to store multiple ancillary roles per employee.
 *
 * The form is a multi-select but the DB schema only had `ancillary_role_id`
 * (single FK), so 3 of every 4 picked roles were silently dropped on save.
 * This adds `ancillary_role_ids` (JSON array). The legacy single column
 * stays — the controller mirrors the first array element into it on every
 * save so any SQL/report still referencing the old column keeps working.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('employees', function (Blueprint $table) {
            $table->json('ancillary_role_ids')->nullable()->after('ancillary_role_id');
        });

        // Backfill: mirror existing single ids into the new array column so
        // the UI immediately renders existing rows through the new path.
        DB::table('employees')
            ->whereNotNull('ancillary_role_id')
            ->update([
                'ancillary_role_ids' => DB::raw("CAST(CONCAT('[', ancillary_role_id, ']') AS JSON)"),
            ]);
    }

    public function down(): void
    {
        Schema::table('employees', function (Blueprint $table) {
            $table->dropColumn('ancillary_role_ids');
        });
    }
};
