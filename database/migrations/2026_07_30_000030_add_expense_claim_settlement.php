<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Expense-claim settlement (post-approval payment). After a claim is approved
 * (Employee → Reporting Manager → HR), Finance records how the company actually
 * paid the employee. Supports a DEDUCTION against the claim (with a reason) and
 * PARTIAL payments — a claim can be paid in installments until the sanctioned
 * amount is met.
 *
 *  • Sanctioned/deduction + running total live on `expense_claims`.
 *  • Each installment is a row in `expense_claim_payments` (the ledger).
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('expense_claims', function (Blueprint $table) {
            // Final amount the company agreed to pay (claimed − deduction). Set on the
            // first "Record Payment"; null until then.
            $table->decimal('sanctioned_amount', 18, 2)->nullable()->after('amount');
            $table->decimal('deduction_amount', 18, 2)->default(0)->after('sanctioned_amount');
            $table->text('deduction_reason')->nullable()->after('deduction_amount');
            // Running total actually paid across installments + where it stands.
            $table->decimal('total_paid', 18, 2)->default(0)->after('deduction_reason');
            $table->string('settlement_status', 16)->default('unpaid')->after('total_paid'); // unpaid | partial | paid
            $table->timestamp('settled_at')->nullable()->after('settlement_status');
        });

        Schema::create('expense_claim_payments', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('client_id')->nullable()->index();
            $table->unsignedBigInteger('branch_id')->nullable()->index();
            $table->unsignedBigInteger('expense_claim_id')->index();
            $table->decimal('amount', 18, 2);
            // Category applied to THIS payment — defaults to the claim's category but the
            // payer can pick/add a different one from the Expense Category master.
            $table->unsignedBigInteger('category_id')->nullable();
            $table->string('category_name', 255)->nullable();
            $table->string('payment_type', 16)->nullable();  // Cash | Cheque | UPI
            $table->string('expense_type', 16)->nullable();  // Goods | Service
            $table->text('note')->nullable();
            $table->unsignedBigInteger('paid_by')->nullable(); // user who recorded it
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
