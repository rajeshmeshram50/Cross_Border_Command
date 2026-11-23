<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('expense_claims', function (Blueprint $table) {
            $table->decimal('sanctioned_amount', 18, 2)->nullable()->after('amount');
            $table->decimal('deduction_amount', 18, 2)->default(0)->after('sanctioned_amount');
            $table->text('deduction_reason')->nullable()->after('deduction_amount');
            $table->decimal('total_paid', 18, 2)->default(0)->after('deduction_reason');
            $table->string('settlement_status', 16)->default('unpaid')->after('total_paid');
            $table->timestamp('settled_at')->nullable()->after('settlement_status');
        });

        Schema::create('expense_claim_payments', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('client_id')->nullable()->index();
            $table->unsignedBigInteger('branch_id')->nullable()->index();
            $table->unsignedBigInteger('expense_claim_id')->index();
            $table->decimal('amount', 18, 2);
            $table->unsignedBigInteger('category_id')->nullable();
            $table->string('category_name', 255)->nullable();
            $table->string('payment_type', 16)->nullable();
            $table->string('expense_type', 16)->nullable();
            $table->text('note')->nullable();
            $table->unsignedBigInteger('paid_by')->nullable();
            $table->timestamp('paid_at')->nullable();
            $table->timestamps();
            $table->softDeletes();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('expense_claim_payments');
        Schema::table('expense_claims', function (Blueprint $table) {
            $table->dropColumn([
                'sanctioned_amount', 'deduction_amount', 'deduction_reason',
                'total_paid', 'settlement_status', 'settled_at',
            ]);
        });
    }
};
