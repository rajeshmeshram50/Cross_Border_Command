<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * customers.is_map_lead — 'Yes' once the customer has been used to create an
 * opportunity, 'No' otherwise.
 *
 * A customer starts at 'No'. The moment a lead is created against it (or an
 * existing lead is mapped to it) the flag flips to 'Yes' and the customer's
 * country becomes read-only: the lead snapshots the customer's country into
 * its own sender_country_* columns and the whole downstream chain (GST
 * applicability, consignee India/non-India pairing, quotation + PI costing)
 * keys off it. Letting the country move after the fact would silently
 * desynchronise every opportunity already hanging off the customer.
 *
 * Stored as a 'Yes'/'No' string rather than a boolean to match the sibling
 * gst_applicable column on the same table.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('customers', function (Blueprint $table) {
            $table->string('is_map_lead', 8)->default('No')->after('status');
        });

        // Backfill: any customer already referenced by a lead is mapped.
        DB::statement(<<<'SQL'
            UPDATE customers
               SET is_map_lead = 'Yes'
             WHERE EXISTS (
                   SELECT 1 FROM leads
                    WHERE leads.customer_id = customers.id
                      AND leads.deleted_at IS NULL
             )
        SQL);
    }

    public function down(): void
    {
        Schema::table('customers', function (Blueprint $table) {
            $table->dropColumn('is_map_lead');
        });
    }
};
