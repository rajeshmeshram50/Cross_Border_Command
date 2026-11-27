<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('p2p_service_suppliers', function (Blueprint $table) {
            $table->string('status', 20)->default('active')->index()->after('remarks');
        });
    }

    public function down(): void
    {
        Schema::table('p2p_service_suppliers', function (Blueprint $table) {
            $table->dropColumn('status');
        });
    }
};
