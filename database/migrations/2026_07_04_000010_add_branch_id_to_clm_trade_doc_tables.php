<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Branch-isolate the Trade Documents Master (CBC — "Branch 2 sees Branch 1's
 * trade documents"). Adds branch_id to the trade-doc names + library tables so
 * the standard MasterVisibility read scope applies: branch users see globals +
 * client-level rows + their own branch's rows, sibling branches stay hidden.
 *
 * Backfill mirrors that model — a row inherits its creator's branch; rows
 * created by client-level users (creator branch_id NULL) stay client-level
 * (branch_id NULL = shared across all branches).
 */
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

            // Postgres UPDATE ... FROM: stamp branch-owned rows with their
            // creator's branch. Client-level creators (branch_id NULL) are
            // skipped, so those rows remain shared.
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
