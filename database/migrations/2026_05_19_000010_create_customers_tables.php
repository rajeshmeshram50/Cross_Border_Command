<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Sales Matrix → Customers — primary tables.
 *
 * Two tables ship together because every customer always has at least
 * one address (the primary one captured on Stage 1), and additional
 * branches/warehouses/shipping addresses are stored as 1-to-many in
 * customer_addresses with `is_primary = false`.
 *
 * Tenant scope is the standard (client_id, branch_id) pair — same
 * pattern as masters/employees so applyScope() applies unchanged.
 *
 * Email uniqueness: the primary contact's email is mirrored onto
 * customers.primary_email so the application layer can validate
 * `unique within tenant` cheaply on POST/PUT.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('customers', function (Blueprint $table) {
            $table->id();

            // Tenant scope (mirrors master tables + employees)
            $table->foreignId('client_id')->nullable()->constrained('clients')->nullOnDelete();
            $table->foreignId('branch_id')->nullable()->constrained('branches')->nullOnDelete();

            // Auto-generated display id (C-0001, C-0002 …) — populated on
            // insert from the row's autoincrement id. Stored separately so
            // the user-facing code stays stable even if the row gets soft
            // deleted and restored.
            $table->string('customer_code', 32)->nullable()->unique();

            // Company identity
            $table->string('company_name', 255);
            $table->string('legal_name', 255)->nullable();
            $table->string('type', 64)->nullable();           // Customer Type (master)
            $table->string('segment', 64)->nullable();        // Customer Segment (master)
            $table->string('classification', 64)->nullable(); // Customer Classification (master)
            $table->string('risk_level', 32)->nullable();     // Risk Level (master)
            $table->string('website', 500)->nullable();

            // Primary contact email — mirrored from the primary address
            // row so the unique check at the customer level is one column,
            // not a join. Indexed (client_id, primary_email).
            $table->string('primary_email', 255)->nullable();

            $table->string('status', 16)->default('Active');
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();

            $table->timestamps();
            $table->softDeletes();

            $table->index('status');
            $table->index('type');
            $table->index('classification');
            // Per-tenant lookups + email uniqueness check happen against
            // this composite index. NULL client_id (super-admin global)
            // rows live in their own partition naturally.
            $table->index(['client_id', 'branch_id']);
            $table->index(['client_id', 'primary_email']);
        });

        Schema::create('customer_addresses', function (Blueprint $table) {
            $table->id();
            $table->foreignId('customer_id')->constrained('customers')->cascadeOnDelete();

            // Address part
            $table->string('type', 64);            // Address Type (master)
            $table->text('address_line');
            $table->string('country', 64)->nullable();
            $table->string('state', 64)->nullable();
            $table->string('city', 64)->nullable();
            $table->string('pin', 16)->nullable();

            // Contact person at this address (previously a separate
            // ContactRow on the frontend; merged here because every
            // address always carries its own contact person).
            $table->string('cp_name', 255);
            $table->string('cp_designation', 128)->nullable();
            $table->string('cp_contact', 32)->nullable();
            $table->string('cp_email', 255)->nullable();
            $table->string('cp_whatsapp', 4)->nullable(); // 'yes' | 'no'

            // Marks the primary location captured on Stage 1. Exactly one
            // per customer; enforced at the application layer on save.
            $table->boolean('is_primary')->default(false);

            $table->timestamps();

            $table->index('customer_id');
            $table->index(['customer_id', 'is_primary']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('customer_addresses');
        Schema::dropIfExists('customers');
    }
};