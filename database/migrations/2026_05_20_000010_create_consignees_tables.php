<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Sales Matrix → Consignees — primary tables.
 *
 * Mirrors the customers + customer_addresses schema with one extra
 * column: customer_id, the FK linking a consignee to the customer
 * account it was created under (the Add Consignee modal's phase A
 * picker resolves this).
 *
 * Tenant scope (client_id, branch_id) matches customers so the
 * applyScope() helper carries across.
 *
 * primary_email mirrors the primary contact's email so unique-within-
 * tenant validation stays a single-column lookup.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('consignees', function (Blueprint $table) {
            $table->id();

            // Tenant scope
            $table->foreignId('client_id')->nullable()->constrained('clients')->nullOnDelete();
            $table->foreignId('branch_id')->nullable()->constrained('branches')->nullOnDelete();

            // The customer this consignee was created under. A
            // consignee is always linked to a customer (phase A of the
            // Add Consignee modal forces the selection). Cascade-delete
            // so removing a customer wipes its consignees too.
            $table->foreignId('customer_id')->constrained('customers')->cascadeOnDelete();

            // Display id (CN-001, CN-002 …) — populated post-insert
            // from the row's autoincrement id. Same pattern as
            // customers.customer_code.
            $table->string('consignee_code', 32)->nullable()->unique();

            // Company identity
            $table->string('company_name', 255);
            $table->string('legal_name', 255)->nullable();
            $table->string('segment', 64)->nullable();        // master
            $table->string('classification', 64)->nullable(); // master
            $table->string('risk_level', 32)->nullable();     // master
            $table->string('website', 500)->nullable();

            // Mirror of primary contact email — unique within tenant.
            $table->string('primary_email', 255)->nullable();

            $table->string('status', 16)->default('Active');
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();

            $table->timestamps();
            $table->softDeletes();

            $table->index('status');
            $table->index('classification');
            $table->index(['client_id', 'branch_id']);
            $table->index(['client_id', 'primary_email']);
            $table->index('customer_id');
        });

        Schema::create('consignee_addresses', function (Blueprint $table) {
            $table->id();
            $table->foreignId('consignee_id')->constrained('consignees')->cascadeOnDelete();

            // Address
            $table->string('type', 64);
            $table->text('address_line');
            $table->string('country', 64)->nullable();
            $table->string('state', 64)->nullable();
            $table->string('city', 64)->nullable();
            $table->string('pin', 16)->nullable();

            // Contact person at this address
            $table->string('cp_name', 255);
            $table->string('cp_designation', 128)->nullable();
            $table->string('cp_contact', 32)->nullable();
            $table->string('cp_email', 255)->nullable();
            $table->string('cp_whatsapp', 4)->nullable(); // 'yes' | 'no'

            // Primary = the one captured on Stage 1 (always exactly one
            // per consignee; enforced at the controller layer).
            $table->boolean('is_primary')->default(false);

            $table->timestamps();

            $table->index('consignee_id');
            $table->index(['consignee_id', 'is_primary']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('consignee_addresses');
        Schema::dropIfExists('consignees');
    }
};
