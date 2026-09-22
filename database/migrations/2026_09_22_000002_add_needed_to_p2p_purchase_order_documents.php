<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * This PO's own answer to "is this document needed here?", the way a lead
 * answers it per deal (clm_lead_doc_needs). `is_required` stays what the CLM
 * library says — mandatory or not — and is never edited from the PO.
 *
 * null = nobody decided yet, which is deliberately not the same as 'no'.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('p2p_purchase_order_documents', function (Blueprint $t) {
            $t->enum('needed', ['yes', 'no'])->nullable()->after('is_required');
            $t->unsignedBigInteger('needed_by')->nullable()->after('needed');
            $t->timestamp('needed_at')->nullable()->after('needed_by');
        });
    }

    public function down(): void
    {
        Schema::table('p2p_purchase_order_documents', function (Blueprint $t) {
            $t->dropColumn(['needed', 'needed_by', 'needed_at']);
        });
    }
};
