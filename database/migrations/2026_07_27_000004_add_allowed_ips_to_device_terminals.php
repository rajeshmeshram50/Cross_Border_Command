<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('device_terminals', function (Blueprint $table) {
            $table->string('allowed_ips', 255)->nullable()->after('ingest_token');
        });
    }

    public function down(): void
    {
        Schema::table('device_terminals', function (Blueprint $table) {
            $table->dropColumn('allowed_ips');
        });
    }
};
