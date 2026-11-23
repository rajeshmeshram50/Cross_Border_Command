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

            $table->string('txn_id', 100)->unique()->nullable();
            $table->string('order_id', 100)->nullable();
            $table->decimal('amount', 10, 2)->nullable();
            $table->decimal('gst', 10, 2)->nullable()->default(0);
            $table->decimal('discount', 10, 2)->nullable()->default(0);
            $table->decimal('total', 10, 2)->nullable();
            $table->string('currency', 5)->nullable()->default('INR');

            $table->string('method', 50)->nullable();
            $table->string('card_info', 100)->nullable();
            $table->string('gateway', 50)->nullable();

            $table->string('billing_cycle', 20)->nullable();
            $table->date('valid_from')->nullable();
            $table->date('valid_until')->nullable();
            $table->boolean('auto_renew')->nullable()->default(false);

            $table->string('status', 20)->nullable()->default('pending');

            $table->decimal('refund_amount', 10, 2)->nullable();
            $table->string('refund_reason', 255)->nullable();
            $table->timestamp('refunded_at')->nullable();

            $table->string('invoice_number', 50)->nullable();
            $table->string('invoice_path', 500)->nullable();

            $table->jsonb('gateway_response')->nullable();
            $table->text('notes')->nullable();
            $table->foreignId('processed_by')->nullable()->constrained('users')->nullOnDelete();

            $table->timestamps();

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
