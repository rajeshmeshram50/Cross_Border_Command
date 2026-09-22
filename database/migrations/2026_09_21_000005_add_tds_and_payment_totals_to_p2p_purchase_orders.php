<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('p2p_purchase_orders', function (Blueprint $t) {
            // One TDS per PO, editable until the first payment is recorded.
            $t->decimal('tds_percentage', 6, 2)->default(0);
            $t->decimal('tds_amount', 16, 2)->default(0);
            $t->unsignedBigInteger('tds_updated_by')->nullable();
            $t->timestamp('tds_updated_at')->nullable();
            // Rebuilt from p2p_po_payments on every payment save: balance = grand total − TDS − paid.
            $t->decimal('paid_amount', 16, 2)->default(0);
            $t->decimal('balance_amount', 16, 2)->default(0);
        });

        // Existing POs have nothing paid yet: their balance is the full value.
        DB::table('p2p_purchase_orders')->update(['balance_amount' => DB::raw('COALESCE(grand_total, 0)')]);
    }

    public function down(): void
    {
        Schema::table('p2p_purchase_orders', function (Blueprint $t) {
            $t->dropColumn(['tds_percentage', 'tds_amount', 'tds_updated_by', 'tds_updated_at', 'paid_amount', 'balance_amount']);
        });
    }
};
