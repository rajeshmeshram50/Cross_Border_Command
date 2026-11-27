<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('advance_recovery_ledger')) {
            return;
        }
        Schema::table('advance_recovery_ledger', function (Blueprint $table) {
            if (!Schema::hasColumn('advance_recovery_ledger', 'stream')) {
                $table->string('stream', 12)->default('self')->after('advance_request_id');
            }
        });
        Schema::table('advance_recovery_ledger', function (Blueprint $table) {
            $table->dropUnique('adv_recovery_uniq');
            $table->unique(['advance_request_id', 'stream', 'year', 'month'], 'adv_recovery_stream_uniq');
        });
    }

    public function down(): void
    {
        if (!Schema::hasTable('advance_recovery_ledger')) {
            return;
        }
        Schema::table('advance_recovery_ledger', function (Blueprint $table) {
            $table->dropUnique('adv_recovery_stream_uniq');
            $table->unique(['advance_request_id', 'year', 'month'], 'adv_recovery_uniq');
            $table->dropColumn('stream');
        });
    }
};
