<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * GST state code (2-digit, e.g. 27 = Maharashtra) for the customer's primary
     * address, derived from the chosen state via master_state_codes.
     *
     * Mirrors vendor_addresses.state_code — same type and nullability — so the
     * customer and supplier sides stay comparable. Nullable because it only
     * applies to a domestic (India) address; an international customer has no
     * GST state code.
     */
    public function up(): void
    {
        Schema::table('customer_addresses', function (Blueprint $table) {
            $table->string('state_code', 32)->nullable()->after('state');
        });
    }

    public function down(): void
    {
        Schema::table('customer_addresses', function (Blueprint $table) {
            $table->dropColumn('state_code');
        });
    }
};
