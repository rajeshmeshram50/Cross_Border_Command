<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Records WHO acted at the reporting-manager stage of an expense claim / advance
 * request, so the Approval Audit Log names the exact logged-in user who
 * approved (or rejected) it — the assigned manager, a branch admin acting as
 * the de-facto manager, or anyone else with the right. Mirrors `hr_user_id`
 * for the HR / Finance stage.
 */
return new class extends Migration
{
    public function up(): void
    {
        foreach (['expense_claims', 'advance_requests'] as $table) {
            if (Schema::hasTable($table) && !Schema::hasColumn($table, 'manager_acted_by')) {
                Schema::table($table, function (Blueprint $t) {
                    $t->unsignedBigInteger('manager_acted_by')->nullable()->after('manager_acted_at');
                });
            }
        }
    }

    public function down(): void
    {
        foreach (['expense_claims', 'advance_requests'] as $table) {
            if (Schema::hasTable($table) && Schema::hasColumn($table, 'manager_acted_by')) {
                Schema::table($table, function (Blueprint $t) {
                    $t->dropColumn('manager_acted_by');
                });
            }
        }
    }
};
