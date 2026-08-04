<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Advance-request settlement (post-approval payout) — mirrors the expense-claim
 * settlement flow. After an advance is approved (Employee → Reporting Manager →
 * HR / Finance), HR records how the advance was actually paid out. Supports
 * one-time DEDUCTIONS + ADDITIONS against the requested amount (with reasons)
 * and PARTIAL payments — an advance can be paid in installments until the
 * sanctioned amount is met.
 *
 *  • Sanctioned / deductions / additions + running total live on `advance_requests`.
 *  • Each installment is a row in `advance_request_payments` (the ledger).
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('advance_requests', function (Blueprint $table) {
            // Final amount the company agreed to pay out (requested − deductions +
            // additions). Set on the first "Record Payment"; null until then.
            $table->decimal('sanctioned_amount', 18, 2)->nullable()->after('amount');
            $table->decimal('deduction_amount', 18, 2)->default(0)->after('sanctioned_amount');
            $table->text('deduction_reason')->nullable()->after('deduction_amount');
            $table->json('deductions')->nullable()->after('deduction_reason');
            $table->decimal('addition_amount', 18, 2)->default(0)->after('deductions');
            $table->json('additions')->nullable()->after('addition_amount');
            // Running total actually paid across installments + where it stands.
            $table->decimal('total_paid', 18, 2)->default(0)->after('additions');
            $table->string('settlement_status', 16)->default('unpaid')->after('total_paid'); // unpaid | partial | paid
            $table->timestamp('settled_at')->nullable()->after('settlement_status');
        });

        Schema::create('advance_request_payments', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('client_id')->nullable()->index();
            $table->unsignedBigInteger('branch_id')->nullable()->index();
            $table->unsignedBigInteger('advance_request_id')->index();
            $table->decimal('amount', 18, 2);
            $table->string('payment_type', 32)->nullable();  // UPI | PhonePe | Cheque | Bank Transfer
            $table->text('note')->nullable();
            $table->string('proof_path', 512)->nullable();
            $table->string('proof_name', 255)->nullable();
            $table->unsignedBigInteger('paid_by')->nullable(); // user who recorded it
            $table->timestamp('paid_at')->nullable();
            $table->timestamps();
            $table->softDeletes();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('advance_request_payments');
        Schema::table('advance_requests', function (Blueprint $table) {
            $table->dropColumn([
                'sanctioned_amount', 'deduction_amount', 'deduction_reason', 'deductions',
                'addition_amount', 'additions',
                'total_paid', 'settlement_status', 'settled_at',
            ]);
        });
    }
};
