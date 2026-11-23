<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('expense_claims', function (Blueprint $table) {
            $table->timestamp('reimbursement_emailed_at')->nullable()->after('settled_at');
        });
    }

    public function down(): void
    {
        Schema::table('expense_claims', function (Blueprint $table) {
            $table->dropColumn('reimbursement_emailed_at');
        });
    }
};
