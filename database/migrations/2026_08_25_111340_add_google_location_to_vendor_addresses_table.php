<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('vendor_addresses', function (Blueprint $table) {
            $table->string('google_location', 1000)->nullable()->after('pincode');
        });
    }

    public function down(): void
    {
        Schema::table('vendor_addresses', function (Blueprint $table) {
            $table->dropColumn('google_location');
        });
    }
};
