<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Settlement now supports ADDITIONS as well as deductions. An addition is an
 * itemised { amount, reason } that INCREASES the payable (e.g. reimbursable
 * extras approved on top of the claim). Net payable = claim − Σ deductions + Σ additions.
 * Stored as a JSON list plus a running total, mirroring the deductions columns.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('expense_claims', function (Blueprint $table) {
            $table->json('additions')->nullable()->after('deductions');
            $table->decimal('addition_amount', 18, 2)->default(0)->after('additions');
        });
    }

    public function down(): void
    {
        Schema::table('expense_claims', function (Blueprint $table) {
            $table->dropColumn(['additions', 'addition_amount']);
        });
    }
};
