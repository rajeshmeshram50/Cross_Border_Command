<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Branch-scope the per-code uniqueness of the branch-isolated CLM masters
 * (Clause, Authority, Agreement). These tables shipped with a client-wide
 * unique(client_id, code); once branch_id was added and the code counter
 * was made to restart at 001 per branch, that client-wide index blocked a
 * second branch from ever creating its own CL-001 / AUTH-001 / AT-001 /
 * A-001 (unique violation against Branch 1's row). Widen the index to
 * (client_id, branch_id, code) so each branch owns its own sequence, while
 * still preventing a duplicate code inside a single branch.
 *
 * NOTE: Postgres treats NULLs as distinct, so client-level rows (branch_id
 * NULL) are not enforced by this index — the nextCode() skip-taken logic
 * already prevents duplicates among the shared rows, matching prior
 * behaviour.
 */
return new class extends Migration {
    private array $tables = [
        'clm_clause_types',
        'clm_clause_library',
        'clm_authorities',
        'clm_agreement_types',
        'clm_agreement_library',
    ];

    public function up(): void
    {
        foreach ($this->tables as $table) {
            if (!Schema::hasColumn($table, 'branch_id')) continue;
            Schema::table($table, function (Blueprint $t) use ($table) {
                $t->dropUnique($table . '_client_id_code_unique');
                $t->unique(['client_id', 'branch_id', 'code']);
            });
        }
    }

    public function down(): void
    {
        foreach ($this->tables as $table) {
            if (!Schema::hasColumn($table, 'branch_id')) continue;
            Schema::table($table, function (Blueprint $t) use ($table) {
                $t->dropUnique($table . '_client_id_branch_id_code_unique');
                $t->unique(['client_id', 'code']);
            });
        }
    }
};
