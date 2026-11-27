<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('p2p_spi_putaway_tasks', function (Blueprint $table) {
            $table->timestamp('box_confirmed_at')->nullable()->after('box_scan_at');
            $table->timestamp('shelf_confirmed_at')->nullable()->after('shelf_scan_at');
            $table->unsignedSmallInteger('fail_count')->default(0)->after('shelf_confirmed_at');
        });
    }

    public function down(): void
    {
        Schema::table('p2p_spi_putaway_tasks', function (Blueprint $table) {
            $table->dropColumn(['box_confirmed_at', 'shelf_confirmed_at', 'fail_count']);
        });
    }
};
