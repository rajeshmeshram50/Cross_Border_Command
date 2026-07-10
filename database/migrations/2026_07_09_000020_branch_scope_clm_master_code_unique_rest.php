<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Companion to 2026_07_09_000010 — extends the same branch-scoped code
 * uniqueness to the remaining branch-isolated CLM masters (Segment, KYC,
 * DD, Trade License, QC, Trade Documents, T&C). Each shipped with a
 * client-wide unique(client_id, code); now that branch_id exists and the
 * code counter restarts at 001 per branch, that index would block a second
 * branch from creating its own SG-001 / KYC-001 / … . Widen the index to
 * (client_id, branch_id, code) so every branch owns its own sequence while
 * still blocking a duplicate code within one branch.
 *
 * NOTE: Postgres treats NULLs as distinct, so client-level rows (branch_id
 * NULL) are not enforced by this index — nextCode()'s skip-taken logic
 * already prevents duplicates among the shared rows, matching prior
 * behaviour.
 */
return new class extends Migration {
    private array $tables = [
        'clm_segments',
        'clm_kyc_documents',
        'clm_dd_documents',
        'clm_trade_licenses',
        'clm_qc_documents',
        'clm_trade_doc_names',
        'clm_trade_doc_library',
        'clm_tnc_categories',
        'clm_tnc_library',
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
