<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

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
