<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Payment Requests History: one row per request raised on a PO.
        // paid_amount is rebuilt from p2p_po_payments on every payment save.
        Schema::create('p2p_po_payment_requests', function (Blueprint $t) {
            $t->id();
            // Payment Request Management lists requests across POs, so it filters on these directly.
            $t->unsignedBigInteger('client_id');
            $t->unsignedBigInteger('branch_id')->nullable();
            $t->unsignedBigInteger('purchase_order_id');

            $t->string('code', 32);                               // Payment Request ID
            $t->string('payment_type', 32);                       // Advance / Partial / Final / Balance
            $t->decimal('percentage', 6, 2)->nullable();          // Payment % of the PO total
            $t->decimal('requested_amount', 16, 2);
            $t->text('reason')->nullable();                       // why the payment is needed

            $t->unsignedBigInteger('requested_by');
            $t->unsignedBigInteger('requested_to');                // approver (user id)
            $t->timestamp('requested_at')->nullable();

            $t->enum('status', ['pending', 'approved', 'rejected'])->default('pending');
            $t->decimal('approved_amount', 16, 2)->nullable();     // may be less than requested
            $t->text('decision_note')->nullable();                 // approval note or decline reason
            $t->timestamp('decided_at')->nullable();
            $t->decimal('paid_amount', 16, 2)->default(0);        // Σ payments against this request

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
