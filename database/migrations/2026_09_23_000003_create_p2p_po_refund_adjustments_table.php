<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Advance Receipt Refund Adjustment: raised when a PO with money released is cancelled.
        Schema::create('p2p_po_refund_adjustments', function (Blueprint $t) {
            $t->id();
            $t->unsignedBigInteger('client_id');
            $t->unsignedBigInteger('branch_id')->nullable();
            $t->string('code', 32);                                    // ADR/2026-27/001
            $t->unsignedBigInteger('purchase_order_id');
            $t->unsignedBigInteger('vendor_id')->nullable();

            $t->date('refund_date');
            $t->string('supplier_ref_no', 64)->nullable();
            $t->string('attachment_path', 500)->nullable();
            $t->string('attachment_name', 255)->nullable();
            $t->string('refund_type', 20);                             // Full Refund | Partial Refund
            $t->string('reason', 500);

            $t->decimal('paid_amount', 16, 2)->default(0);             // paid on the PO when raised
            $t->decimal('refund_amount', 16, 2)->default(0);           // owed back by the supplier
            $t->decimal('retained_amount', 16, 2)->default(0);         // kept by the supplier
            $t->string('retained_type', 80)->nullable();
            $t->string('retained_remark', 300)->nullable();
            $t->decimal('recovered_amount', 16, 2)->default(0);        // rebuilt from recoveries
            $t->decimal('balance_amount', 16, 2)->default(0);          // refund minus recovered
            $t->string('status', 20)->default('pending');              // pending | partial | recovered

            // Zoho Books vendor credit, applied to the PO's bill.
            $t->string('zoho_vendorcredit_id', 64)->nullable();
            $t->string('zoho_vendorcredit_number', 64)->nullable();
            $t->decimal('zoho_applied_amount', 16, 2)->default(0);
            $t->string('zoho_sync_status', 20)->nullable();            // synced | failed
            $t->timestamp('zoho_synced_at')->nullable();
            $t->text('zoho_error')->nullable();

            $t->unsignedBigInteger('created_by')->nullable();
            $t->unsignedBigInteger('updated_by')->nullable();
            $t->timestamps();
            $t->softDeletes();

            $t->unique('purchase_order_id');
            $t->unique(['client_id', 'code']);
            $t->index(['client_id', 'status']);
            $t->index('vendor_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('p2p_po_refund_adjustments');
    }
};
