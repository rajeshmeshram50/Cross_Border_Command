<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Company-advance amount distribution: a JSON array of rows
 * ({amount, purpose, payment_type, proof_index}) that sum to the total amount.
 * Guarded with hasColumn so it's a no-op where the column already exists.
 */
return new class extends Migration {
    public function up(): void
    {
        if (!Schema::hasColumn('advance_requests', 'request_items')) {
            Schema::table('advance_requests', function (Blueprint $table) {
                $table->json('request_items')->nullable()->after('attachments');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('advance_requests', 'request_items')) {
            Schema::table('advance_requests', function (Blueprint $table) {
                $table->dropColumn('request_items');
            });
        }
    }
};
