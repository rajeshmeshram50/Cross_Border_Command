<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * CTC contracts can now be sent for counterparty signing via Zoho Sign.
 * `zoho_request_id` links the contract to its Zoho signature request so the
 * Stage-3 signing tracker can sync each signer's status back from Zoho;
 * `signature_request_id` points at the clm_signature_requests audit row.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('ctc_contracts', function (Blueprint $table) {
            $table->string('zoho_request_id')->nullable()->index()->after('days_to_sign');
            $table->unsignedBigInteger('signature_request_id')->nullable()->after('zoho_request_id');
        });
    }

    public function down(): void
    {
        Schema::table('ctc_contracts', function (Blueprint $table) {
            $table->dropColumn(['zoho_request_id', 'signature_request_id']);
        });
    }
};
