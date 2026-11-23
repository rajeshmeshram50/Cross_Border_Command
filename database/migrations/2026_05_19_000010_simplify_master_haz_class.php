<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('master_haz_class', function (Blueprint $table) {
            if (Schema::hasColumn('master_haz_class', 'haz_code')) {
                $table->dropColumn('haz_code');
            }
            if (Schema::hasColumn('master_haz_class', 'packing_group')) {
                $table->dropColumn('packing_group');
            }
        });
    }

    public function down(): void
    {
        Schema::table('master_haz_class', function (Blueprint $table) {
            if (!Schema::hasColumn('master_haz_class', 'haz_code')) {
                $table->string('haz_code', 255)->nullable()->after('name');
            }
            if (!Schema::hasColumn('master_haz_class', 'packing_group')) {
                $table->enum('packing_group', ['I (High Danger)', 'II (Medium Danger)', 'III (Low Danger)', 'N/A'])
                    ->nullable()
                    ->after('haz_code');
            }
        });
    }
};
