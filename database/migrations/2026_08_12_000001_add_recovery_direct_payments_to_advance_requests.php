<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        if (!Schema::hasColumn('advance_requests', 'recovery_direct_payments')) {
            Schema::table('advance_requests', function (Blueprint $table) {
                $table->json('recovery_direct_payments')->nullable()->after('recovery_start');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('advance_requests', 'recovery_direct_payments')) {
            Schema::table('advance_requests', function (Blueprint $table) {
                $table->dropColumn('recovery_direct_payments');
            });
        }
    }
};
