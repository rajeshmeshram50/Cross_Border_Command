<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Customer GST Scrutiny — mirrors vendor_gst_scrutiny.
 *
 * One row per GST number a (domestic / India) customer is registered
 * under, capturing the filing status and compliance red-flags surfaced
 * during due-diligence. Managed from the "GST Scrutiny" popup on the
 * Add Customer modal, which is only relevant when the customer's
 * `gst_applicable` flag (added here on the customers table) is 'Yes'.
 *
 * Cascades on customer delete; soft-deletes per the rest of the
 * customer KYC tables so a removed entry stays auditable.
 */
return new class extends Migration
{
    public function up(): void
    {
        // Stage 1 flag — drives whether the GST Scrutiny button shows.
        Schema::table('customers', function (Blueprint $table) {
            // 'Yes' | 'No'. Nullable so existing rows aren't forced; the
            // form makes it required for new/edited customers.
            $table->string('gst_applicable', 8)->nullable()->after('risk_level');
        });

        Schema::create('customer_gst_scrutiny', function (Blueprint $table) {
            $table->id();
            $table->foreignId('customer_id')->constrained('customers')->cascadeOnDelete();

            $table->string('gst_number', 16);
            $table->string('status', 16)->default('Active');   // Active|Suspended|Cancelled
            $table->date('last_filing_date')->nullable();
            $table->string('prev_non_gst_2a_invoice', 255)->nullable();
            $table->text('red_flags')->nullable();

            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->softDeletes();

            $table->index('customer_id');
            $table->index('gst_number');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('customer_gst_scrutiny');
        Schema::table('customers', function (Blueprint $table) {
            $table->dropColumn('gst_applicable');
        });
    }
};
