<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Money received back from the supplier against a refund adjustment.
        Schema::create('p2p_po_refund_recoveries', function (Blueprint $t) {
            $t->id();
            $t->unsignedBigInteger('client_id');
            $t->unsignedBigInteger('branch_id')->nullable();
            $t->unsignedBigInteger('refund_adjustment_id');
            $t->unsignedBigInteger('purchase_order_id');

            $t->decimal('amount', 16, 2);
            $t->date('recovered_date');
            $t->string('reference_no', 64)->nullable();                // cheque / UTR
            $t->string('proof_path', 500)->nullable();
            $t->string('proof_name', 255)->nullable();

            // Zoho Books vendor credit refund.
            $t->string('zoho_refund_id', 64)->nullable();
            $t->string('zoho_sync_status', 20)->nullable();            // synced | failed
            $t->timestamp('zoho_synced_at')->nullable();
            $t->text('zoho_error')->nullable();

            $t->unsignedBigInteger('created_by')->nullable();
            $t->unsignedBigInteger('updated_by')->nullable();
            $t->timestamps();
            $t->softDeletes();

            $t->index('refund_adjustment_id');
            $t->index('purchase_order_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('p2p_po_refund_recoveries');
    }
};
