<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * CTC contract lifecycle — versions + signing.
 *
 * `versions` is an append-only audit of every draft/revision/decision/sign
 * event (each carries a content snapshot so any version can be re-downloaded).
 * `signing_recipients` tracks the counterparties the agreement was sent to for
 * e-signature and their individual signed state.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('ctc_contracts', function (Blueprint $table) {
            $table->json('versions')->nullable()->after('clarifications');
            $table->json('signing_recipients')->nullable()->after('versions');
            $table->unsignedSmallInteger('days_to_sign')->nullable()->after('signing_recipients');
        });
    }

    public function down(): void
    {
        Schema::table('ctc_contracts', function (Blueprint $table) {
            $table->dropColumn(['versions', 'signing_recipients', 'days_to_sign']);
        });
    }
};
