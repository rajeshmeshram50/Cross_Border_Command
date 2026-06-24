<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Address Type for vendor addresses. The supplier form's primary address now
 * carries a selectable type loaded from the address_types master (Registered
 * Office / Warehouse / Branch), mirroring the Customer form. Stored as the
 * type NAME for display parity with the master.
 */
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
