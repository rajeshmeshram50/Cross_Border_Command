<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * P2P · Create Purchase Order — the new PO backend (independent of the older
 * `purchase_orders` tables, which are left untouched).
 *
 *   1. p2p_purchase_orders          PO header: stages 01 and 03, GST gate, totals,
 *                                   cancellation and the inspection sign-off
 *   2. p2p_purchase_order_items     Stage 02: the 2-way match — each PO line
 *                                   against the exact PI line it orders from
 *   3. p2p_po_item_qty_histories    Append-only log of every quantity change on
 *                                   a line (previous → current), per PI line
 *   4. p2p_purchase_order_documents Stage 04: generated / signed documents
 *   5. p2p_po_physical_inspections  Per-line inspection verdict and proof
 *
 * Business fields are nullable so a draft can be saved stage by stage; every
 * fixed-value field (including yes/no toggles) is an enum, which on PostgreSQL
 * is a CHECK constraint — a bad value is refused by the database itself.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('p2p_purchase_orders', function (Blueprint $t) {
            $t->id();
            $t->foreignId('client_id')->constrained('clients')->cascadeOnDelete();
            $t->foreignId('branch_id')->nullable()->constrained('branches')->nullOnDelete();

            $t->string('code', 30);                                    // PO/2025-26/001
            $t->date('po_date')->nullable();
            $t->enum('status', ['draft', 'submitted', 'cancelled'])->default('draft');
            $t->unsignedSmallInteger('current_step')->nullable()->default(1); // furthest stage saved (1–4)

            // Stage 01 · basic details
            $t->enum('po_type', ['material_goods', 'services', 'ffd_transporter'])->nullable();
            $t->enum('document_type', ['domestic', 'international'])->nullable();
            $t->string('mode_of_transport', 40)->nullable();
            $t->date('expected_delivery_date')->nullable();
            $t->string('delivery_location', 255)->nullable();
            $t->string('payment_type', 60)->nullable();
            $t->enum('physical_inspection', ['yes', 'no'])->nullable()->default('no');

            // Stage 01 · international only
            $t->string('currency_code', 8)->nullable()->default('INR');
            $t->decimal('exchange_rate', 14, 6)->nullable();
            $t->string('inco_term', 32)->nullable();
            $t->string('port_of_loading', 128)->nullable();
            $t->string('port_of_discharge', 128)->nullable();
            $t->string('final_destination', 128)->nullable();
            $t->string('country_of_origin', 128)->nullable();

            // What the PO is raised against: a shipment (and its PI), or standalone
            $t->enum('link_type', ['with_shipment', 'standalone'])->nullable();
            // Optional procurement request; no FK, the P2P procurement module is not built yet
            $t->enum('link_procurement', ['yes', 'no'])->nullable();
            $t->unsignedBigInteger('procurement_request_id')->nullable();
            $t->string('procurement_request_code', 30)->nullable();
            $t->foreignId('shipment_order_id')->nullable()->constrained('shipment_orders')->nullOnDelete();
            $t->foreignId('proforma_invoice_id')->nullable()->constrained('proforma_invoices')->nullOnDelete();
            $t->unsignedBigInteger('lead_id')->nullable();               // opportunity

            // Supplier — details are read from vendors, not copied here
            $t->foreignId('vendor_id')->nullable()->constrained('vendors')->nullOnDelete();

            // Tax: intra-state = CGST + SGST, inter-state = IGST
            $t->string('home_state_code', 4)->nullable();
            $t->enum('tax_mode', ['intra', 'inter'])->nullable();

            // GST compliance gate, evaluated on the supplier's latest scrutiny
            $t->enum('gst_gate', ['clear', 'approval_required', 'blocked'])->nullable();
            $t->date('gst_scrutiny_date')->nullable();
            $t->date('gst_last_filing_date')->nullable();
            $t->enum('gst_approval_status', ['pending', 'approved', 'rejected'])->nullable();
            $t->foreignId('gst_approval_requested_by')->nullable()->constrained('users')->nullOnDelete();
            $t->timestamp('gst_approval_requested_at')->nullable();
            $t->foreignId('gst_approval_by')->nullable()->constrained('users')->nullOnDelete();
            $t->timestamp('gst_approval_at')->nullable();
            $t->text('gst_approval_note')->nullable();

            // Stage 02 · charges and totals (always computed server-side)
            $t->decimal('taxable_total', 16, 2)->nullable()->default(0);
            $t->decimal('total_cgst', 16, 2)->nullable()->default(0);
            $t->decimal('total_sgst', 16, 2)->nullable()->default(0);
            $t->decimal('total_igst', 16, 2)->nullable()->default(0);
            $t->decimal('shipping_charges', 16, 2)->nullable()->default(0);
            $t->decimal('packaging_charges', 16, 2)->nullable()->default(0);
            $t->decimal('other_charges', 16, 2)->nullable()->default(0);
            $t->decimal('grand_total', 16, 2)->nullable()->default(0);

            // Stage 03
            $t->text('terms')->nullable();
            $t->timestamp('submitted_at')->nullable();
            $t->foreignId('submitted_by')->nullable()->constrained('users')->nullOnDelete();

            // Cancellation
            $t->timestamp('cancelled_at')->nullable();
            $t->foreignId('cancelled_by')->nullable()->constrained('users')->nullOnDelete();
            $t->text('cancel_reason')->nullable();

            // Physical inspection sign-off (per-line verdicts live in table 5)
            $t->enum('inspection_status', ['not_required', 'pending', 'completed'])->nullable()->default('not_required');
            $t->text('inspection_note')->nullable();
            $t->json('inspection_note_files')->nullable();
            $t->foreignId('inspected_by')->nullable()->constrained('users')->nullOnDelete();
            $t->timestamp('inspected_at')->nullable();

            // Who — always the authenticated user, never taken from the request body
            $t->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $t->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $t->timestamps();
            $t->softDeletes();

            $t->unique(['client_id', 'code']);
            $t->index(['client_id', 'status']);
            $t->index(['client_id', 'branch_id', 'po_date']);
            $t->index('shipment_order_id');
            $t->index('vendor_id');
            $t->index(['client_id', 'link_type']);
            $t->index('procurement_request_id');
        });

        Schema::create('p2p_purchase_order_items', function (Blueprint $t) {
            $t->id();
            $t->foreignId('purchase_order_id')->constrained('p2p_purchase_orders')->cascadeOnDelete();
            $t->unsignedSmallInteger('line_no');

            // PI line it orders from (null on a manual line); PI details are read live
            $t->foreignId('pi_item_id')->nullable()->constrained('proforma_invoice_items')->nullOnDelete();
            // Product ordered (may differ from the PI's); code, name, HSN, UOM read live
            $t->foreignId('product_id')->nullable()->constrained('products')->nullOnDelete();
            $t->text('description')->nullable();

            $t->decimal('quantity', 16, 3)->nullable();
            $t->decimal('rate', 16, 2)->nullable();
            $t->decimal('gst_pct', 5, 2)->nullable();
            $t->decimal('taxable_amount', 16, 2)->nullable();
            $t->decimal('cgst_amount', 16, 2)->nullable();
            $t->decimal('sgst_amount', 16, 2)->nullable();
            $t->decimal('igst_amount', 16, 2)->nullable();
            $t->decimal('line_total', 16, 2)->nullable();

            $t->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $t->timestamps();

            $t->unique(['purchase_order_id', 'pi_item_id']);           // a PI line appears once per PO
            $t->index('pi_item_id');
        });

        Schema::create('p2p_po_item_qty_histories', function (Blueprint $t) {
            $t->id();
            $t->foreignId('client_id')->constrained('clients')->cascadeOnDelete();
            $t->unsignedBigInteger('branch_id')->nullable();
            $t->foreignId('purchase_order_id')->constrained('p2p_purchase_orders')->cascadeOnDelete();
            $t->foreignId('purchase_order_item_id')->nullable()->constrained('p2p_purchase_order_items')->nullOnDelete();
            $t->foreignId('pi_item_id')->nullable()->constrained('proforma_invoice_items')->nullOnDelete();
            $t->unsignedBigInteger('shipment_order_id')->nullable();
            $t->unsignedBigInteger('product_id')->nullable();

            $t->enum('event', ['added', 'updated', 'removed', 'cancelled', 'deleted']);
            $t->decimal('pi_quantity', 16, 3)->nullable();
            $t->decimal('previous_qty', 16, 3)->nullable();
            $t->decimal('current_qty', 16, 3)->nullable();
            $t->decimal('change_qty', 16, 3)->nullable();              // current − previous
            $t->decimal('pending_after', 16, 3)->nullable();           // PI qty still open once this change applied

            $t->foreignId('changed_by')->nullable()->constrained('users')->nullOnDelete();
            $t->timestamp('created_at')->useCurrent();                  // append-only: no updated_at

            $t->index(['pi_item_id', 'created_at']);
            $t->index('purchase_order_id');
            $t->index(['client_id', 'shipment_order_id']);
        });

        Schema::create('p2p_purchase_order_documents', function (Blueprint $t) {
            $t->id();
            $t->foreignId('client_id')->constrained('clients')->cascadeOnDelete();
            $t->unsignedBigInteger('branch_id')->nullable();
            $t->foreignId('purchase_order_id')->constrained('p2p_purchase_orders')->cascadeOnDelete();

            $t->string('code', 30);                                    // DOC/2025-26/001
            $t->string('name', 150)->nullable();
            $t->enum('doc_kind', ['purchase_order', 'agreement', 'other'])->nullable()->default('other');
            $t->enum('is_required', ['yes', 'no'])->nullable()->default('no');
            $t->date('generated_on')->nullable();
            $t->date('valid_up_to')->nullable();

            $t->string('file_path', 500)->nullable();
            $t->string('original_name', 255)->nullable();
            $t->string('mime_type', 100)->nullable();
            $t->unsignedBigInteger('size_bytes')->nullable();

            $t->enum('status', ['pending', 'sent', 'signed'])->nullable()->default('pending');
            $t->timestamp('sent_at')->nullable();
            $t->timestamp('signed_at')->nullable();
            $t->unsignedBigInteger('signature_request_id')->nullable(); // Zoho Sign request, when wired

            $t->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $t->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $t->timestamps();
            $t->softDeletes();

            $t->unique(['client_id', 'code']);
            $t->index('purchase_order_id');
        });

        Schema::create('p2p_po_physical_inspections', function (Blueprint $t) {
            $t->id();
            $t->foreignId('purchase_order_id')->constrained('p2p_purchase_orders')->cascadeOnDelete();
            $t->foreignId('purchase_order_item_id')->constrained('p2p_purchase_order_items')->cascadeOnDelete();

            $t->enum('verdict', ['correct', 'damaged', 'mismatched'])->nullable();
            $t->text('remark')->nullable();
            $t->json('proof_files')->nullable();                       // [{path, name, mime, size}]

            $t->foreignId('inspected_by')->nullable()->constrained('users')->nullOnDelete();
            $t->timestamp('inspected_at')->nullable();
            $t->timestamps();

            $t->unique('purchase_order_item_id');                      // one verdict per PO line
            $t->index('purchase_order_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('p2p_po_physical_inspections');
        Schema::dropIfExists('p2p_purchase_order_documents');
        Schema::dropIfExists('p2p_po_item_qty_histories');
        Schema::dropIfExists('p2p_purchase_order_items');
        Schema::dropIfExists('p2p_purchase_orders');
    }
};
