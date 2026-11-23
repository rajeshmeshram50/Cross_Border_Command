<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('p2p_po_payment_requests', function (Blueprint $t) {
            $t->id();
            $t->unsignedBigInteger('client_id');
            $t->unsignedBigInteger('branch_id')->nullable();
            $t->unsignedBigInteger('purchase_order_id');

            $t->string('code', 32);
            $t->string('payment_type', 32);
            $t->decimal('percentage', 6, 2)->nullable();
            $t->decimal('requested_amount', 16, 2);
            $t->text('reason')->nullable();

            $t->unsignedBigInteger('requested_by');
            $t->unsignedBigInteger('requested_to');
            $t->timestamp('requested_at')->nullable();

            $t->enum('status', ['pending', 'approved', 'rejected'])->default('pending');
            $t->decimal('approved_amount', 16, 2)->nullable();
            $t->text('decision_note')->nullable();
            $t->timestamp('decided_at')->nullable();
            $t->decimal('paid_amount', 16, 2)->default(0);

            $t->timestamps();

            $t->index('purchase_order_id');
            $t->index(['client_id', 'status']);
            $t->index(['requested_to', 'status']);
            $t->index(['client_id', 'code']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('p2p_po_payment_requests');
    }
};
