<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('purchase_orders', function (Blueprint $table) {
            $table->dropUnique(['client_id', 'code']);
            $table->unique(['client_id', 'branch_id', 'code']);
        });
    }

    public function down(): void
    {
        Schema::table('purchase_orders', function (Blueprint $table) {
            $table->dropUnique(['client_id', 'branch_id', 'code']);
            $table->unique(['client_id', 'code']);
        });
    }
};
