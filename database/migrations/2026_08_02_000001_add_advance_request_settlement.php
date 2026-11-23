<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('advance_requests', function (Blueprint $table) {
            $table->decimal('sanctioned_amount', 18, 2)->nullable()->after('amount');
            $table->decimal('deduction_amount', 18, 2)->default(0)->after('sanctioned_amount');
            $table->text('deduction_reason')->nullable()->after('deduction_amount');
            $table->json('deductions')->nullable()->after('deduction_reason');
            $table->decimal('addition_amount', 18, 2)->default(0)->after('deductions');
            $table->json('additions')->nullable()->after('addition_amount');
            $table->decimal('total_paid', 18, 2)->default(0)->after('additions');
            $table->string('settlement_status', 16)->default('unpaid')->after('total_paid');
            $table->timestamp('settled_at')->nullable()->after('settlement_status');
        });

        Schema::create('advance_request_payments', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('client_id')->nullable()->index();
            $table->unsignedBigInteger('branch_id')->nullable()->index();
            $table->unsignedBigInteger('advance_request_id')->index();
            $table->decimal('amount', 18, 2);
            $table->string('payment_type', 32)->nullable();
            $table->text('note')->nullable();
            $table->string('proof_path', 512)->nullable();
            $table->string('proof_name', 255)->nullable();
            $table->unsignedBigInteger('paid_by')->nullable();
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
