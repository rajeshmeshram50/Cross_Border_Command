<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('master_vendor_directory', function (Blueprint $table) {
            $table->string('vendor_company_name', 512)->nullable()->change();
        });
    }

    public function down(): void
    {
        Schema::table('master_vendor_directory', function (Blueprint $table) {
            $table->string('vendor_company_name', 255)->nullable()->change();
        });
    }
};
