<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * P2P · Supplier Purchase Invoice (SPI) — header.
 *
 * Four flavours, and the two splits are independent:
 *   with PO    + with shipment / without shipment
 *   without PO + standalone (the supplier is picked directly)
 *
 * Everything conditional in this module keys off `purchase_order_id IS NULL`.
 *
 * What is deliberately NOT here: lead_id, shipment_order_id and
 * procurement_request_code. p2p_purchase_orders already stores all three, so a
 * copy would be a second place for one fact to drift. A standalone invoice has
 * no PO, and therefore no lead or shipment to show either way.
 *
 * Business fields are nullable so a draft can be saved stage by stage; every
 * fixed-value field is an enum, which on PostgreSQL is a CHECK constraint.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('p2p_supplier_invoices', function (Blueprint $t) {
            $t->id();
            $t->unsignedBigInteger('client_id')->index();
            // NOT NULL because the code sequence is per branch: a row with no
            // branch would have no sequence to belong to, and the unique below
            // would not catch a duplicate (Postgres treats NULLs as distinct).
            $t->unsignedBigInteger('branch_id')->index();

            $t->string('code', 30);                      // SPI/2026-27/001
            // NULL for a standalone invoice: the prototype offers "Without
            // Purchase Order", where the supplier is picked directly.
            $t->unsignedBigInteger('purchase_order_id')->nullable()->index();
            // Always known — inherited from the PO, or chosen on a standalone.
            $t->unsignedBigInteger('vendor_id')->index();

            // Stage 01 · the supplier's own invoice
            $t->string('invoice_no', 60)->nullable();
            $t->date('invoice_date')->nullable();
            $t->string('invoice_file_path', 255)->nullable();
            $t->string('invoice_file_name', 160)->nullable();
            $t->string('eway_no', 40)->nullable();
            $t->string('eway_file_path', 255)->nullable();
            $t->string('eway_file_name', 160)->nullable();

            // Totals — rolled up from the items on save, never sent by the client.
            $t->decimal('taxable_total', 15, 2)->default(0);
            $t->decimal('total_cgst', 15, 2)->default(0);
            $t->decimal('total_sgst', 15, 2)->default(0);
            $t->decimal('total_igst', 15, 2)->default(0);
            $t->decimal('grand_total', 15, 2)->default(0);

            // Drives whether the tax section shows at all. Stored rather than
            // read from the PO because a standalone invoice has no PO.
            $t->enum('document_type', ['domestic', 'international'])->default('domestic');
            $t->char('currency_code', 3)->nullable();
            $t->decimal('exchange_rate', 12, 6)->nullable();   // snapshot at booking

            $t->unsignedSmallInteger('stage_completed')->default(1);   // furthest stage saved (1-4)
            $t->enum('status', ['draft', 'mapped', 'grn_pending', 'closed', 'cancelled'])->default('draft');
            $t->unsignedBigInteger('warehouse_id')->nullable()->index();

            /* Zoho Books. Only a STANDALONE invoice creates its own bill: with a
               PO the bill already exists on p2p_purchase_orders.zoho_bill_id and
               must not be created twice. */
            $t->string('zoho_bill_id', 64)->nullable();
            $t->string('zoho_bill_number', 64)->nullable();
            $t->string('zoho_status', 20)->nullable();
            $t->text('zoho_error')->nullable();
            $t->timestamp('zoho_synced_at')->nullable();

            $t->unsignedBigInteger('created_by')->nullable();
            $t->unsignedBigInteger('updated_by')->nullable();
            $t->timestamps();
            $t->softDeletes();

            // Per BRANCH, not per client: each branch runs its own sequence, so
            // two branches legitimately both hold SPI/2026-27/001.
            $t->unique(['client_id', 'branch_id', 'code']);
            // One supplier cannot bill the same invoice number twice — this one
            // stays client-wide, because the supplier is the same company
            // whichever branch of ours bought from them.
            $t->unique(['client_id', 'vendor_id', 'invoice_no']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('p2p_supplier_invoices');
    }
};
