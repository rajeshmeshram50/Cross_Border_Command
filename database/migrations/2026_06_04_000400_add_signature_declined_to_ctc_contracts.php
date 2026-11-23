<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

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
