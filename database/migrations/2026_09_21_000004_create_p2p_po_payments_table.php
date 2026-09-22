<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Payment History: each payment released against an approved payment request.
        Schema::create('p2p_po_payments', function (Blueprint $t) {
            $t->id();
            $t->unsignedBigInteger('client_id');
            $t->unsignedBigInteger('branch_id')->nullable();
            $t->unsignedBigInteger('purchase_order_id');
            $t->unsignedBigInteger('payment_request_id');

            $t->decimal('amount', 16, 2);
            $t->string('bank_name', 128)->nullable();
            $t->string('utr_cheque_number', 64)->nullable();
            $t->date('utr_cheque_date')->nullable();
            $t->string('proof_path', 500)->nullable();
            $t->string('proof_name', 255)->nullable();

            $t->unsignedBigInteger('created_by')->nullable();
            $t->unsignedBigInteger('updated_by')->nullable();
            $t->timestamps();
            $t->softDeletes();

            $t->index('payment_request_id');
            $t->index('purchase_order_id');
            $t->index(['client_id', 'utr_cheque_number']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('p2p_po_payments');
    }
};
