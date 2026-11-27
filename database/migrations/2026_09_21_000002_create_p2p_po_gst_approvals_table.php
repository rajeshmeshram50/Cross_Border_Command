<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('p2p_po_gst_approvals', function (Blueprint $t) {
            $t->id();
            $t->unsignedBigInteger('purchase_order_id');
            $t->unsignedBigInteger('requested_by');
            $t->unsignedBigInteger('requested_to');
            $t->text('request_note')->nullable();
            $t->timestamp('requested_at')->nullable();

            $t->enum('status', ['pending', 'approved', 'rejected'])->default('pending');
            $t->text('reason')->nullable();
            $t->timestamp('decided_at')->nullable();

            $t->timestamps();

            $t->index(['purchase_order_id', 'status']);
            $t->index(['requested_to', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('p2p_po_gst_approvals');
    }
};
