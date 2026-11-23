<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('p2p_spi_putaway_tasks', function (Blueprint $table) {
            $table->timestamp('zone_scan_at')->nullable()->after('box_confirmed_at');
            $table->timestamp('rack_scan_at')->nullable()->after('zone_scan_at');
        });
    }

    public function down(): void
    {
        Schema::table('p2p_spi_putaway_tasks', function (Blueprint $table) {
            $table->dropColumn(['zone_scan_at', 'rack_scan_at']);
        });
    }
};
