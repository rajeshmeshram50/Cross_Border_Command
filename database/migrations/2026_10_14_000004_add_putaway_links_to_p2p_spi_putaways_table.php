<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('p2p_spi_putaways', function (Blueprint $t) {
            $t->unsignedBigInteger('occupancy_id')->nullable()->after('shelf_id');
            $t->unsignedBigInteger('task_id')->nullable()->after('occupancy_id');
            $t->unsignedBigInteger('suggested_shelf_id')->nullable()->after('task_id');
            $t->string('verify_method', 10)->nullable()->after('confirmed_by');
        });
    }

    public function down(): void
    {
        Schema::table('p2p_spi_putaways', function (Blueprint $t) {
            $t->dropColumn(['occupancy_id', 'task_id', 'suggested_shelf_id', 'verify_method']);
        });
    }
};
