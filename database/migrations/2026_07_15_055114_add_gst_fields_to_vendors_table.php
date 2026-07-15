<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Mirrors the customers table (gst_applicable + gst_number). The supplier's
     * GST number is captured once on Stage 1 (Supplier Identification) and flows
     * read-only into every GST Scrutiny entry, instead of being retyped per row.
     */
    public function up(): void
    {
        Schema::table('vendors', function (Blueprint $table) {
            $table->string('gst_applicable')->nullable()->after('website');
            $table->string('gst_number')->nullable()->after('gst_applicable');
        });
    }

    public function down(): void
    {
        Schema::table('vendors', function (Blueprint $table) {
            $table->dropColumn(['gst_applicable', 'gst_number']);
        });
    }
};
