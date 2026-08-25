<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Google Maps link on a supplier's address.
 *
 * A typed address line does not locate a supplier's premises — Indian
 * industrial estates repeat plot numbers across sectors, and an overseas
 * address is unverifiable from the text alone. A pasted Maps link is how
 * procurement and audit actually find the place, so it belongs beside the
 * address rather than in the notes.
 *
 * Applies to domestic and international suppliers alike; nothing about it is
 * India-specific.
 *
 * 1000, not 255: Google's share URLs carry a place id and a coordinate pair,
 * and a copied browser URL (the `/maps/place/…/@lat,lng,17z/data=…` form)
 * regularly runs past 500 characters. Matches address_line's own limit.
 */
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
