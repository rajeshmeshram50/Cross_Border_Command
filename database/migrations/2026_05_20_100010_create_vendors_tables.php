<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Vendors — primary tables.
 *
 *  vendors
 *    Stage 1 of the Add Vendor wizard: legal identity + classification.
 *    Classification dropdowns store master IDs (vendor_type_id,
 *    risk_level_id, segment_id, …) — the wizard sends ids and the
 *    controller joins on read to render labels.
 *
 *  vendor_addresses
 *    Stage 1 sub-tab: the registered-office address + primary contact +
 *    any extra contact persons captured in the "Additional Contact
 *    Persons" popup. Exactly one row is flagged `is_primary = true` —
 *    that's the office + KYC contact. Additional rows are extra
 *    contacts (no separate address) and only carry contact fields.
 *
 *  Tenant scope is the standard (client_id, branch_id) pair so
 *  MasterVisibility::applyReadScope() works unchanged.
 *
 *  Email mirrored onto vendors.primary_email lets the unique-within-
 *  tenant check stay a one-column lookup at save time.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('vendors', function (Blueprint $table) {
            $table->id();

            // Tenant scope — mirrors masters/customers/employees so the
            // creator-hierarchy read scope and edit denial drop in unchanged.
            $table->foreignId('client_id')->nullable()->constrained('clients')->nullOnDelete();
            $table->foreignId('branch_id')->nullable()->constrained('branches')->nullOnDelete();

            // Auto-generated display id (V-01, V-02 …). Populated by the
            // controller on first save and stays stable across renames.
            $table->string('vendor_code', 32)->nullable()->unique();

            // Legal identity (Stage 1 — Vendor Identification)
            $table->string('company_name', 255);
            $table->string('legal_name', 255)->nullable();
            $table->string('website', 500)->nullable();

            // Classification masters — FK ids, not labels. NullOnDelete
            // keeps the vendor row alive if a master row gets removed; the
            // app re-fetches labels via JOIN so a stale id renders blank.
            $table->foreignId('vendor_type_id')->nullable()->constrained('master_vendor_types')->nullOnDelete();
            $table->foreignId('risk_level_id')->nullable()->constrained('master_risk_levels')->nullOnDelete();
            $table->foreignId('vendor_behaviour_id')->nullable()->constrained('master_vendor_behaviour')->nullOnDelete();
            $table->foreignId('segment_id')->nullable()->constrained('master_segments')->nullOnDelete();
            $table->foreignId('compliance_behaviour_id')->nullable()->constrained('master_compliance_behaviours')->nullOnDelete();

            // Mirrored from the primary address's contact email so the
            // unique-within-tenant check is a single-column lookup.
            $table->string('primary_email', 255)->nullable();

            // draft → inactive (after KYC) → active (after product map).
            // Mirrors ProductController's status flow.
            $table->string('status', 16)->default('draft');

            // Wizard progress flag — 1=identity, 2=kyc, 3=trade-docs
            // (skipped on backend), 4=products / active. Lets the SPA
            // resume on the right tab when an in-progress vendor is
            // re-opened.
            $table->unsignedTinyInteger('step_completed')->default(0);

            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();

            $table->timestamps();
            $table->softDeletes();

            $table->index('status');
            $table->index(['client_id', 'branch_id']);
            $table->index(['client_id', 'primary_email']);
        });

        Schema::create('vendor_addresses', function (Blueprint $table) {
            $table->id();
            $table->foreignId('vendor_id')->constrained('vendors')->cascadeOnDelete();

            // Address fields — only meaningful on the primary row.
            // Country/state masters as FK ids; state_code is denormalised
            // copy of master_state_codes.state_code so existing UI keeps
            // working without an extra JOIN.
            $table->text('address_line')->nullable();
            $table->foreignId('country_id')->nullable()->constrained('master_countries')->nullOnDelete();
            $table->foreignId('state_id')->nullable()->constrained('master_states')->nullOnDelete();
            $table->string('state_code', 32)->nullable();
            $table->string('city', 128)->nullable();
            $table->string('pincode', 16)->nullable();

            // Contact person carried on every row — the primary row's
            // contact is the vendor's KYC contact; extra rows are just
            // additional people without a distinct address.
            $table->string('contact_name', 255);
            $table->string('designation', 128)->nullable();
            $table->string('contact_no', 32)->nullable();
            $table->string('email', 255)->nullable();
            $table->boolean('whatsapp_enabled')->default(true);

            // Extra-contact attachment (the "Attachments" upload on the
            // contact-person popup). Primary row leaves this null.
            $table->string('attachment_path', 500)->nullable();

            // Exactly one per vendor — enforced at the application layer
            // on save (the controller replace-alls addresses per step).
            $table->boolean('is_primary')->default(false);

            $table->timestamps();

            $table->index('vendor_id');
            $table->index(['vendor_id', 'is_primary']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('vendor_addresses');
        Schema::dropIfExists('vendors');
    }
};
