<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('p2p_spi_boxes', function (Blueprint $t) {
            $t->decimal('temp_min_c', 6, 2)->nullable()->after('is_stackable');
            $t->decimal('temp_max_c', 6, 2)->nullable()->after('temp_min_c');
        });
    }

    public function down(): void
    {
        Schema::table('p2p_spi_boxes', function (Blueprint $t) {
            $t->dropColumn(['temp_min_c', 'temp_max_c']);
        });
    }
};
