<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Sales Matrix → Stage 6 (Victory) → Shipment Order.
 *
 *  Ported from IDIMS's `bt` (Business Task) table. One row per won deal.
 *  Captures shipping + logistics metadata the operations team needs to
 *  dispatch the order: liability, cold-chain, freight, ports, etc.
 *
 *  Joins:
 *    client_id            → tenant
 *    lead_id              → leads.id  (1-to-1 in practice — one shipment
 *                                       per won opportunity)
 *    proforma_invoice_id  → proforma_invoices.id  (the PI being shipped)
 *
 *  attachments is a JSON list of stored file paths (under storage/app/public).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('shipment_orders', function (Blueprint $table) {
            $table->id();
            $table->foreignId('client_id')->constrained('clients')->cascadeOnDelete();
            $table->foreignId('lead_id')->constrained('leads')->cascadeOnDelete();
            $table->foreignId('proforma_invoice_id')->nullable()
                ->constrained('proforma_invoices')->nullOnDelete();

            $table->string('shipping_liability', 64)->nullable(); // Seller / Buyer / Shared
            $table->boolean('cold_chain')->default(false);
            $table->string('zip_code', 32)->nullable();
            $table->decimal('freight_cost', 14, 2)->nullable();
            $table->string('shipping_mode', 64)->nullable();      // Sea Freight / Air / Road / Rail
            $table->string('inco_term', 32)->nullable();          // FOB / CIF / EXW / DAP …
            $table->string('port_of_loading', 128)->nullable();
            $table->string('port_of_unloading', 128)->nullable();
            $table->string('final_destination', 128)->nullable();
            $table->string('origin_country', 64)->nullable();

            $table->json('attachments')->nullable();
            $table->text('remarks')->nullable();

            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique('lead_id'); // One shipment per opportunity
            $table->index(['client_id', 'lead_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('shipment_orders');
    }
};
