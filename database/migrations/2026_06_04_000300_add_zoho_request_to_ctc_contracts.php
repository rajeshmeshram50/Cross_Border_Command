<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

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
