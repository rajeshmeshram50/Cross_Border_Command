<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('advance_requests', function (Blueprint $table) {
            $table->json('settle_items')->nullable()->after('settle_proof_name');
        });
    }

    public function down(): void
    {
        Schema::table('advance_requests', function (Blueprint $table) {
            $table->dropColumn('settle_items');
        });
    }
};
