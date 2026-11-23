<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('advance_requests', function (Blueprint $table) {
            $table->string('settle_declared_type', 16)->nullable()->after('settle_items');
            $table->decimal('settle_target_amount', 18, 2)->nullable()->after('settle_declared_type');
        });
    }

    public function down(): void
    {
        Schema::table('advance_requests', function (Blueprint $table) {
            $table->dropColumn(['settle_declared_type', 'settle_target_amount']);
        });
    }
};
