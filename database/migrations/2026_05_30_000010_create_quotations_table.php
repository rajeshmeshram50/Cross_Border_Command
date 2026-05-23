<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Sales Matrix → Quotations.
 *
 * Header table for outgoing quotations. Mirrors the field set the
 * Create Quotation modal collects on Step 1 ("Basic Quotation Details")
 * plus the totals computed from line items on Step 2.
 *
 * Code sequence: QT/YYYY-NN/SEQ where YYYY-NN is the Indian financial
 * year (e.g. 2026-27 = Apr-2026 through Mar-2027). SEQ resets each
 * fiscal year and is allocated atomically per client (row-lock on
 * clients.id at insert time + the composite UNIQUE on (client_id, code)).
 *
 * Two modes:
 *  - International — full shipping block (currency / inco / ports / origin)
 *  - Domestic     — single state_code instead of the shipping block
 *
 * The form lets the user save either based on the doc_type they pick,
 * so most shipping columns are nullable and validated conditionally
 * in the controller.
 *
 * Soft delete via `status = 'cancelled'`; rows are never hard-deleted
 * so audit trails for converted PIs / contracts always resolve back.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('quotations', function (Blueprint $table) {
            $table->id();

            // Tenant scope — matches every other client-scoped table in the
            // project. Branch is nullable for client-wide rows.
            $table->foreignId('client_id')->constrained('clients')->cascadeOnDelete();
            $table->unsignedBigInteger('branch_id')->nullable()->index();

            // ── Identity ────────────────────────────────────────
            $table->string('code', 32);              // QT/2026-27/1
            $table->unsignedSmallInteger('version')->default(1);

            // ── Document classification ─────────────────────────
            $table->string('doc_type', 16)->default('International'); // International | Domestic

            // ── Party FKs ────────────────────────────────────────
            // Opportunity is the source lead. Nullable because the form
            // explicitly allows "Without Opportunity" general quotations.
            $table->foreignId('opp_id')->nullable()
                  ->constrained('leads')->nullOnDelete();
            $table->string('opp_code', 32)->nullable();      // cached: "OPP-0001"
            $table->date('opportunity_date')->nullable();    // cached: lead.query_time

            $table->foreignId('customer_id')->constrained('customers')->restrictOnDelete();
            $table->string('customer_name', 255)->nullable();  // cached for list display

            $table->foreignId('consignee_id')->nullable()
                  ->constrained('consignees')->nullOnDelete();
            $table->string('consignee_name', 255)->nullable(); // cached

            // ── Banking ──────────────────────────────────────────
            // bank_account_id is FK to the global bank_accounts master.
            // FK is nullable + nullOnDelete in case the master row is
            // archived after a quotation is created.
            $table->unsignedBigInteger('bank_account_id')->nullable()->index();
            $table->string('bank_label', 255)->nullable();   // cached: "Bank Name (Holder)"

            $table->string('currency', 8)->nullable();       // "USD", "INR"
            $table->decimal('exchange_rate', 12, 4)->nullable();

            // ── International-only shipping block ────────────────
            $table->string('inco_term', 16)->nullable();     // "FOB", "CIF"
            $table->string('port_of_loading', 128)->nullable();
            $table->string('port_of_discharge', 128)->nullable();
            $table->string('final_destination', 128)->nullable();  // manual text
            $table->string('origin_country', 64)->nullable();

            // ── Domestic-only ────────────────────────────────────
            // "MH – Maharashtra" stored as a string so the dropdown
            // labels round-trip cleanly. The numeric state_id can be
            // derived from this if a future report needs it.
            $table->string('state_code', 64)->nullable();

            // ── Sales context ────────────────────────────────────
            $table->foreignId('sales_manager_id')->nullable()
                  ->constrained('users')->nullOnDelete();
            $table->string('sales_manager_name', 128)->nullable(); // cached

            // ── Totals (server-computed, never trust client) ────
            $table->decimal('sub_total',   14, 2)->default(0);
            $table->decimal('shipping',    14, 2)->default(0);
            $table->decimal('grand_total', 14, 2)->default(0);

            // ── Lifecycle ────────────────────────────────────────
            // draft → sent → approved → converted_to_pi
            //                        → cancelled (terminal)
            $table->string('status', 24)->default('draft');

            $table->text('terms')->nullable();

            // ── Audit ───────────────────────────────────────────
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            // ── Indices ─────────────────────────────────────────
            // Per-client code uniqueness — second line of defence on top
            // of the lockForUpdate sequence allocator in the controller.
            $table->unique(['client_id', 'code']);

            // Common list-filter combos. Postgres can satisfy each via a
            // single index scan; without these the listing page would
            // sequential-scan on every status / customer filter pill.
            $table->index(['client_id', 'status']);
            $table->index(['client_id', 'customer_id']);
            $table->index(['client_id', 'opp_id']);
            $table->index(['client_id', 'doc_type']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('quotations');
    }
};
