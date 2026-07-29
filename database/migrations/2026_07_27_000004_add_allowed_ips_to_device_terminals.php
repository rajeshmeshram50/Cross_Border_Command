<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Mode C hardening — an optional per-terminal IP allow-list. The eSSL device
 * cannot send an auth/CSRF token, so the only credentials a push carries are
 * its Serial + source IP. When `allowed_ips` is set (comma-separated), a push
 * from any other IP is acknowledged but NOT ingested. Blank = accept any IP
 * (fine for a trusted LAN pilot).
 *
 * See docs/ESSL_ATTENDANCE_INTEGRATION.md §19.
 */
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
