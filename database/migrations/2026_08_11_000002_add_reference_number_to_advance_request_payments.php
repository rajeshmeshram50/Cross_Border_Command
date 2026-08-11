<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * UTR / bank reference number for an advance payout — lets HR/Finance trace the
 * transfer. Guarded so it's a no-op where the column already exists.
 */
return new class extends Migration {
    public function up(): void
    {
        if (!Schema::hasColumn('advance_request_payments', 'reference_number')) {
            Schema::table('advance_request_payments', function (Blueprint $table) {
                $table->string('reference_number', 64)->nullable()->after('payment_type');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('advance_request_payments', 'reference_number')) {
            Schema::table('advance_request_payments', function (Blueprint $table) {
                $table->dropColumn('reference_number');
            });
        }
    }
};
