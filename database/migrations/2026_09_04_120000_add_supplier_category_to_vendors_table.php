<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Supplier Category — the vendor's COMMERCIAL STANDING.
 *
 * Distinct from risk_level_id, which stays. Category answers "how good a
 * supplier is this" (Star down to Blacklisted); risk answers "how much risk
 * does dealing with them carry" (High / Medium / Low). They overlap in wording
 * only: 'high_risk' here is a standing, not a risk score.
 *
 * A plain string with a default rather than a master table: the four values are
 * fixed product vocabulary, not tenant data, and the Refine Suppliers filter
 * counts them by value. Promote it to a master only if tenants need their own.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('vendors', function (Blueprint $table) {
            $table->string('supplier_category', 20)
                  ->default('general')
                  ->after('risk_level_id');
        });

        // Existing rows take the default explicitly, so the column is never
        // null and the list/filter never has to special-case a blank.
        \DB::table('vendors')->whereNull('supplier_category')->update(['supplier_category' => 'general']);
    }

    public function down(): void
    {
        Schema::table('vendors', function (Blueprint $table) {
            $table->dropColumn('supplier_category');
        });
    }
};
