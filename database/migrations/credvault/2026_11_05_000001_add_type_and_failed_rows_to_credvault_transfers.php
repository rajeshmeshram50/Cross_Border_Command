<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('credvault_transfers', function (Blueprint $t) {
            if (!Schema::hasColumn('credvault_transfers', 'credential_type')) $t->string('credential_type', 20)->nullable()->after('source');
            if (!Schema::hasColumn('credvault_transfers', 'failed')) $t->unsignedInteger('failed')->default(0)->after('duplicates');
            if (!Schema::hasColumn('credvault_transfers', 'failed_rows')) $t->json('failed_rows')->nullable()->after('failed');
        });
    }

    public function down(): void
    {
        Schema::table('credvault_transfers', function (Blueprint $t) {
            foreach (['failed_rows', 'failed', 'credential_type'] as $c) {
                if (Schema::hasColumn('credvault_transfers', $c)) $t->dropColumn($c);
            }
        });
    }
};
