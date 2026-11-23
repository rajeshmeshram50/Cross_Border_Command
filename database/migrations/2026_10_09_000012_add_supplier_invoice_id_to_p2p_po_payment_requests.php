<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('p2p_po_payment_requests', function (Blueprint $t) {
            $t->unsignedBigInteger('supplier_invoice_id')->nullable()->after('purchase_order_id');
            $t->index('supplier_invoice_id');
        });
    }

    public function down(): void
    {
        Schema::table('p2p_po_payment_requests', function (Blueprint $t) {
            $t->dropIndex(['supplier_invoice_id']);
            $t->dropColumn('supplier_invoice_id');
        });
    }
};
