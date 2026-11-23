<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('expense_batch_payments', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('client_id');
            $table->unsignedBigInteger('branch_id')->nullable();
            $table->unsignedBigInteger('employee_id');
            $table->string('reference_number', 120);
            $table->string('payment_type', 40);
            $table->decimal('total_amount', 18, 2)->default(0);
            $table->string('note', 500)->nullable();
            $table->string('proof_path')->nullable();
            $table->string('proof_name')->nullable();
            $table->string('zoho_status', 20)->default('not_synced');
            $table->timestamp('zoho_synced_at')->nullable();
            $table->string('zoho_expense_id', 64)->nullable();
            $table->unsignedBigInteger('paid_by')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->index(['client_id', 'branch_id', 'employee_id']);
        });

        Schema::table('expense_claim_payments', function (Blueprint $table) {
            if (!Schema::hasColumn('expense_claim_payments', 'batch_payment_id')) {
                $table->unsignedBigInteger('batch_payment_id')->nullable()->after('expense_claim_id');
                $table->index('batch_payment_id');
            }
        });
    }

    public function down(): void
    {
        Schema::table('expense_claim_payments', function (Blueprint $table) {
            $table->dropColumn('batch_payment_id');
        });
        Schema::dropIfExists('expense_batch_payments');
    }
};
