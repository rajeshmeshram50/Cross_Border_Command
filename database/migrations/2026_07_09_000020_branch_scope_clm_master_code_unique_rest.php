<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

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
