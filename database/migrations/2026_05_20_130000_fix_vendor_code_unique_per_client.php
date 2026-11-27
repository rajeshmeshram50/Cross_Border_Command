<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('vendors', function (Blueprint $table) {
            $table->dropUnique('vendors_vendor_code_unique');
            $table->unique(['client_id', 'vendor_code'], 'vendors_client_id_vendor_code_unique');
        });
    }

    public function down(): void
    {
        Schema::table('vendors', function (Blueprint $table) {
            $table->dropUnique('vendors_client_id_vendor_code_unique');
            $table->unique('vendor_code', 'vendors_vendor_code_unique');
        });
    }
};
