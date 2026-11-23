<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('vendor_addresses', function (Blueprint $table) {
            if (!Schema::hasColumn('vendor_addresses', 'address_type')) {
                $table->string('address_type', 64)->nullable()->after('vendor_id');
            }
        });
    }

    public function down(): void
    {
        Schema::table('vendor_addresses', function (Blueprint $table) {
            if (Schema::hasColumn('vendor_addresses', 'address_type')) {
                $table->dropColumn('address_type');
            }
        });
    }
};
