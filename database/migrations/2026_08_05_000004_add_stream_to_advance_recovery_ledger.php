<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A single advance can be recovered on two independent streams:
 *   - "self"   — the employee repaying the advance they took (recovery_*).
 *   - "return" — the employee returning UNUSED advance via payroll
 *                (settle_return_*), scheduled at settlement time.
 *
 * Both can carry their own EMI + carry-forward in the same month, so the ledger
 * must key on the stream too — otherwise the return row would overwrite the
 * self row (same advance_request_id, year, month).
 */
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
            // Swap the (advance,year,month) uniqueness for one that includes the
            // stream so self + return coexist per advance per month.
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
