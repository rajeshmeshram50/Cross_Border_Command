<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

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
