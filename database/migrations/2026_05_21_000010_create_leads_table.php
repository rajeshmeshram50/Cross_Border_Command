<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Sales Matrix → Leads (My Workplace).
 *
 * Powers the /sales/lead-worksheet page. Three feeders write here:
 *
 *   1. Manual capture        — POST /sales/leads             (platform: 'Offline', query_type: 'Manual')
 *   2. IndiaMart sync        — POST /sales/leads/sync        (platform: 'Agrotech' / 'Purvee' / 'Vortex')
 *   3. TradeIndia sync       — (future)                      (platform: 'TradeIndia')
 *
 * Sender contact info is denormalized onto the row (no separate
 * `lead_customers` table like the old IDIMS_6.0 design — that table only
 * existed for IndiaMart enrichment and confused the data model). When a
 * lead is promoted to a real customer/consignee, `customer_id` /
 * `consignee_id` get populated.
 *
 * External-ID uniqueness is enforced as composite (client_id, platform,
 * unique_query_id) so the same IndiaMart UNIQUE_QUERY_ID can never collide
 * across tenants, and a re-sync upserts in place.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('leads', function (Blueprint $table) {
            $table->id();

            // ── Tenant scope (mirrors customers / consignees pattern).
            //    branch_id stays nullable so client-level rows from the sync
            //    job (which doesn't know a branch) land cleanly.
            $table->foreignId('client_id')->constrained('clients')->cascadeOnDelete();
            $table->foreignId('branch_id')->nullable()->constrained('branches')->nullOnDelete();

            // ── Opportunity identity
            $table->string('opp_code', 32)->unique();          // OPP-0001 — what the UI shows
            $table->string('unique_query_id', 64)->nullable(); // IndiaMart UNIQUE_QUERY_ID / TradeIndia rfi_id / random for manual

            // ── Source / type
            $table->string('platform', 32);          // Offline | Agrotech | Purvee | Vortex | TradeIndia
            $table->string('query_type', 32);        // Manual | Direct Enquiries | PNS Calls | …
            $table->string('source_account', 64)->nullable(); // free-text label of the CRM key/account
            $table->timestamp('query_time')->nullable();

            // ── Sender (denormalized — no separate lead_customers table)
            $table->string('sender_name', 255);
            $table->string('sender_mobile', 32)->nullable();
            $table->string('sender_email', 255)->nullable();
            $table->string('sender_company', 255)->nullable();
            $table->text  ('sender_address')->nullable();
            $table->string('sender_city', 128)->nullable();
            $table->string('sender_state', 128)->nullable();
            $table->string('sender_pincode', 32)->nullable();
            $table->string('sender_country_iso', 8)->nullable();
            $table->string('sender_country_name', 128)->nullable(); // TradeIndia returns the full name
            $table->string('sender_mobile_alt', 32)->nullable();
            $table->string('sender_email_alt', 255)->nullable();

            // ── Query content
            $table->string('query_product_name', 255)->nullable();
            $table->text  ('query_message')->nullable();
            $table->string('product_quantity', 64)->nullable();
            $table->string('query_mcat_name', 255)->nullable();

            // ── Pipeline state
            $table->unsignedTinyInteger('lead_stage_id')->default(1); // 1..8
            $table->boolean('qualified')->default(true);
            $table->boolean('disqualified')->default(false);
            $table->boolean('key_opportunity')->default(false);

            // ── WhatsApp (drives the "WhatsApp Status" column in the table)
            $table->boolean('has_whatsapp')->default(false);
            $table->text  ('whatsapp_reason')->nullable();
            $table->string('whatsapp_screenshot', 500)->nullable();
            $table->string('whatsapp_status', 16)->default('pending'); // pending | yes | no

            // ── Assignment
            $table->foreignId('salesperson_id')->nullable()->constrained('users')->nullOnDelete();

            // ── Linkage when promoted to real master records
            $table->foreignId('customer_id')->nullable()->constrained('customers')->nullOnDelete();
            $table->foreignId('consignee_id')->nullable()->constrained('consignees')->nullOnDelete();

            // ── Acknowledgement (disqualification / qualification reason)
            $table->foreignId('lead_ack_reason_id')->nullable()->constrained('lead_ack_reasons')->nullOnDelete();

            // ── Audit
            $table->text('remark')->nullable();
            $table->string('price', 64)->nullable();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();

            $table->timestamps();
            $table->softDeletes();

            // ── Indexes (matches the filter signature in SalesLeadController@index)
            $table->index(['client_id', 'branch_id']);
            $table->index(['client_id', 'qualified', 'disqualified']);
            $table->index(['client_id', 'salesperson_id']);
            $table->index(['client_id', 'platform']);
            $table->index(['client_id', 'query_time']);

            // Composite unique replaces the old project's random-collision risk:
            // same external ID can only exist once per (tenant, platform).
            $table->unique(['client_id', 'platform', 'unique_query_id'], 'leads_external_unique');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('leads');
    }
};
