<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    private array $tables = ['clm_trade_doc_names', 'clm_trade_doc_library'];

    public function up(): void
    {
        foreach ($this->tables as $table) {
            if (!Schema::hasColumn($table, 'branch_id')) {
                Schema::table($table, function (Blueprint $t) {
                    $t->foreignId('branch_id')->nullable()->after('client_id')
                        ->constrained('branches')->nullOnDelete();
                });
            }

            DB::statement("
                UPDATE {$table} AS t
                SET branch_id = u.branch_id
                FROM users AS u
                WHERE t.created_by = u.id
                  AND u.branch_id IS NOT NULL
                  AND t.branch_id IS NULL
            ");
        }
    }

    public function down(): void
    {
        foreach ($this->tables as $table) {
            if (Schema::hasColumn($table, 'branch_id')) {
                Schema::table($table, function (Blueprint $t) {
                    $t->dropConstrainedForeignId('branch_id');
                });
            }
        }
    }
};
