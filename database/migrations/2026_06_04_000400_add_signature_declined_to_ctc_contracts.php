<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Tracks when a CTC's Zoho Sign request was declined by a signer, so the
 * Stage-3 tracker can surface the decline (and reason, stored per-recipient
 * in signing_recipients) and offer an "edit & resend" path without logging a
 * duplicate version event on every status poll.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('ctc_contracts', function (Blueprint $table) {
            $table->timestamp('signature_declined_at')->nullable()->after('signature_request_id');
        });
    }

    public function down(): void
    {
        Schema::table('ctc_contracts', function (Blueprint $table) {
            $table->dropColumn('signature_declined_at');
        });
    }
};
