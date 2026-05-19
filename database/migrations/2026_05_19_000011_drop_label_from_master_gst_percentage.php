<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * GST Percentage master was simplified — the `label` column is no longer
 * shown in the add form or the list and is no longer accepted by the
 * MasterController validation config / model fillable. Drop the column
 * so the schema matches.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('master_gst_percentage', function (Blueprint $table) {
            if (Schema::hasColumn('master_gst_percentage', 'label')) {
                $table->dropColumn('label');
            }
        });
    }

    public function down(): void
    {
        Schema::table('master_gst_percentage', function (Blueprint $table) {
            if (!Schema::hasColumn('master_gst_percentage', 'label')) {
                $table->string('label', 255)->nullable()->after('percentage');
            }
        });
    }
};
