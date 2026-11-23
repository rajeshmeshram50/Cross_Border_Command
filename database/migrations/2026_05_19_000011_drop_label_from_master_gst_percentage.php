<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

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
