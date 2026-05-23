<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Sales Matrix → Proforma Invoices (PI).
 *
 * Mirror of `quotations` but with an `INV/YYYY-NN/SEQ` code sequence,
 * a `pi_type` discriminator (with_shipment | without_shipment) that
 * powers the two pill tabs on the listing, and BT (Bank Transfer)
 * reference fields used for the With-Shipment variant.
 *
 * `source_quotation_id` is nullable — a PI can originate from a
 * Quotation (Convert flow) OR be created standalone (Create PI button).
 *
 * Soft delete via `status = 'cancelled'`. Signature track follows
 * the screenshot's "PI with Signature" / "PI without Signature"
 * action-menu split — captured as `signing_mode`.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('proforma_invoices', function (Blueprint $table) {
            $table->id();

            $table->foreignId('client_id')->constrained('clients')->cascadeOnDelete();
            $table->unsignedBigInteger('branch_id')->nullable()->index();

            // ── Identity ────────────────────────────────────────
            $table->string('code', 32);              // INV/2026-27/1
            $table->unsignedSmallInteger('version')->default(1);

            // PI variants — drives the listing's pill switcher.
            //   'with_shipment'    → carries BT-ID + BT date
            //   'without_shipment' → BT fields stay null
            $table->string('pi_type', 24)->default('with_shipment');

            // BT (Bank Transfer) reference — only populated when
            // pi_type = 'with_shipment'. Stored on the row (not a
            // separate table) because there's exactly 0..1 BT per PI.
            $table->string('bt_id', 24)->nullable();
            $table->date('bt_date')->nullable();

            // Signature workflow — mirrors the action-menu split.
            //   'with_signature'    → uploaded/drawn signature required
            //   'without_signature' → quick PI, signature step skipped
            $table->string('signing_mode', 24)->nullable();

            // ── Conversion provenance ───────────────────────────
            // FK back to the quotation we were converted from (if any).
            // restrictOnDelete so a Quotation that has spawned a PI
            // can't be hard-deleted out from under us.
            $table->foreignId('source_quotation_id')->nullable()
                  ->constrained('quotations')->nullOnDelete();
            $table->string('convert_from_code', 32)->nullable();  // cached QT/...

            // ── Document classification ─────────────────────────
            $table->string('doc_type', 16)->default('International');

            // ── Party FKs (same shape as quotations) ────────────
            $table->foreignId('opp_id')->nullable()
                  ->constrained('leads')->nullOnDelete();
            $table->string('opp_code', 32)->nullable();
            $table->date('opportunity_date')->nullable();

            $table->foreignId('customer_id')->constrained('customers')->restrictOnDelete();
            $table->string('customer_name', 255)->nullable();

            $table->foreignId('consignee_id')->nullable()
                  ->constrained('consignees')->nullOnDelete();
            $table->string('consignee_name', 255)->nullable();

            // ── Banking ──────────────────────────────────────────
            $table->unsignedBigInteger('bank_account_id')->nullable()->index();
            $table->string('bank_label', 255)->nullable();

            $table->string('currency', 8)->nullable();
            $table->decimal('exchange_rate', 12, 4)->nullable();

            // ── International / Domestic shipping block ─────────
            $table->string('inco_term', 16)->nullable();
            $table->string('port_of_loading', 128)->nullable();
            $table->string('port_of_discharge', 128)->nullable();
            $table->string('final_destination', 128)->nullable();
            $table->string('origin_country', 64)->nullable();
            $table->string('state_code', 64)->nullable();

            // ── Sales context ────────────────────────────────────
            $table->foreignId('sales_manager_id')->nullable()
                  ->constrained('users')->nullOnDelete();
            $table->string('sales_manager_name', 128)->nullable();

            // ── Totals (server-computed) ────────────────────────
            $table->decimal('sub_total',   14, 2)->default(0);
            $table->decimal('shipping',    14, 2)->default(0);
            $table->decimal('grand_total', 14, 2)->default(0);

            // draft → sent → approved → converted_to_contract
            //                        → cancelled
            $table->string('status', 24)->default('draft');

            $table->text('terms')->nullable();

            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['client_id', 'code']);
            $table->index(['client_id', 'status']);
            $table->index(['client_id', 'pi_type']);
            $table->index(['client_id', 'customer_id']);
            $table->index(['client_id', 'opp_id']);
            $table->index(['client_id', 'source_quotation_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('proforma_invoices');
    }
};
