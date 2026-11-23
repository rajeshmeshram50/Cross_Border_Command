<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('p2p_purchase_orders', function (Blueprint $t) {
            $t->string('zoho_status', 20)->nullable();
            $t->string('zoho_purchaseorder_id', 64)->nullable();
            $t->string('zoho_bill_id', 64)->nullable();
            $t->string('zoho_bill_number', 64)->nullable();
            $t->timestamp('zoho_synced_at')->nullable();
            $t->text('zoho_error')->nullable();

            $t->string('cancel_stage', 20)->nullable();
            $t->timestamp('cancel_closed_at')->nullable();

            $t->index(['client_id', 'cancel_stage']);
        });
    }

    public function down(): void
    {
        Schema::table('p2p_purchase_orders', function (Blueprint $t) {
            $t->dropIndex(['client_id', 'cancel_stage']);
            $t->dropColumn(['zoho_status', 'zoho_purchaseorder_id', 'zoho_bill_id', 'zoho_bill_number',
                'zoho_synced_at', 'zoho_error', 'cancel_stage', 'cancel_closed_at']);
        });
    }
};
