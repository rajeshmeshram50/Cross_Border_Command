<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The Haz Class master was simplified to just `name` + `status` (matches
 * the other lightweight masters like segments / vendor_behaviour). The
 * legacy `haz_code` and `packing_group` columns are no longer used by
 * the form, validation config, or fillable list — drop them so the
 * schema reflects the new shape.
 */
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
