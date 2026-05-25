<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Sales Matrix → Stage 3 (Product Sourcing) state on each lead⇄product row.
 *
 *  sourcing_status   nullable enum (`required` | `not_required`).
 *                    NULL until the salesperson categorises the row in the
 *                    "Product Details" tab. Inactive / draft products are
 *                    constrained server-side to `required` only.
 *
 *  procurement_done  boolean. Flips when the user clicks "Mark Sourced"
 *                    on a `required` row that has a vendor mapped on the
 *                    product master. Drives the Stage 3 → 4 gate.
 *
 * No procurement-orders table exists in CBC yet — this single flag is the
 * faithful equivalent of IDIMS's `mark_as_done` column on
 * `product_directories` for the SaaS scope.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('lead_products', function (Blueprint $table) {
            $table->enum('sourcing_status', ['required', 'not_required'])
                ->nullable()
                ->after('notes');
            $table->boolean('procurement_done')
                ->default(false)
                ->after('sourcing_status');
        });
    }

    public function down(): void
    {
        Schema::table('lead_products', function (Blueprint $table) {
            $table->dropColumn(['sourcing_status', 'procurement_done']);
        });
    }
};
