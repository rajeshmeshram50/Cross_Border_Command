<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('payments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('client_id')->nullable()->constrained('clients')->cascadeOnDelete();
            $table->foreignId('plan_id')->nullable()->constrained('plans')->nullOnDelete();

            // Transaction
            $table->string('txn_id', 100)->unique()->nullable();
            $table->string('order_id', 100)->nullable(); // gateway order id
            $table->decimal('amount', 10, 2)->nullable();
            $table->decimal('gst', 10, 2)->nullable()->default(0);
            $table->decimal('discount', 10, 2)->nullable()->default(0);
            $table->decimal('total', 10, 2)->nullable();
            $table->string('currency', 5)->nullable()->default('INR');

            // Payment Method
            $table->string('method', 50)->nullable(); // upi, credit_card, debit_card, net_banking, wallet
            $table->string('card_info', 100)->nullable(); // masked: **** 4521 or rajesh@upi
            $table->string('gateway', 50)->nullable(); // razorpay, stripe, paytm

            // Billing Cycle
            $table->string('billing_cycle', 20)->nullable(); // monthly, quarterly, yearly
            $table->date('valid_from')->nullable();
            $table->date('valid_until')->nullable();
            $table->boolean('auto_renew')->nullable()->default(false);

            // Status
            $table->string('status', 20)->nullable()->default('pending'); // pending, success, failed, expired, refunded

            // Refund
            $table->decimal('refund_amount', 10, 2)->nullable();
            $table->string('refund_reason', 255)->nullable();
            $table->timestamp('refunded_at')->nullable();

            // Invoice
            $table->string('invoice_number', 50)->nullable();
            $table->string('invoice_path', 500)->nullable(); // PDF path

            // Meta
            $table->jsonb('gateway_response')->nullable();
            $table->text('notes')->nullable();
            $table->foreignId('processed_by')->nullable()->constrained('users')->nullOnDelete();

            $table->timestamps();

            // Indexes
            $table->index('client_id');
            $table->index('status');
            $table->index('txn_id');
            $table->index('valid_until');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('payments');
    }
};
