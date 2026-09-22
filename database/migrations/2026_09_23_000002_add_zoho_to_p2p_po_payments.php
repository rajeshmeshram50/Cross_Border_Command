<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Each payment is posted to Zoho as a vendor payment against the PO's bill.
        Schema::table('p2p_po_payments', function (Blueprint $t) {
            $t->string('zoho_payment_id', 64)->nullable();
            $t->decimal('zoho_applied_amount', 16, 2)->default(0);
            $t->string('zoho_sync_status', 20)->nullable();            // synced | failed
            $t->timestamp('zoho_synced_at')->nullable();
            $t->text('zoho_error')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('p2p_po_payments', function (Blueprint $t) {
            $t->dropColumn(['zoho_payment_id', 'zoho_applied_amount', 'zoho_sync_status', 'zoho_synced_at', 'zoho_error']);
        });
    }
};
