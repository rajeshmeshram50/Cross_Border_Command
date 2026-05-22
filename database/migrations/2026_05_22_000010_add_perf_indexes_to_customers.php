<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Performance indexes for the Customers list at scale.
 *
 * Once a tenant has a few thousand customers, the existing indexes
 * (client_id+branch_id, status, type, classification) miss the hot
 * paths that get added per-row by MasterVisibility::applyReadScope
 * and the default order:
 *
 *   - `created_by` is used by the employee peer-isolation clause
 *     (`whereIn('created_by', $mainAdminIds)` + `orWhere created_by = self`).
 *     Without the index a sub-branch employee's list view full-scans
 *     the customers table.
 *
 *   - `created_at` backs the default `orderByDesc('created_at')` (also
 *     used by the leads / opportunities surfaces that join into
 *     customers). Without it Postgres has to sort the full result
 *     set in memory.
 *
 * Both are pure index additions — no schema change, no data
 * rewrite, safe to roll forward and back.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('customers', function (Blueprint $table) {
            // Visibility filter (employee peer isolation + creator
            // shortcut in hierarchicalDenial).
            $table->index('created_by', 'customers_created_by_idx');
            // Default ordering — orderByDesc('id') is already covered
            // by the PK, but routes that switch to created_at win
            // here. Composite (client_id, created_at desc) also
            // accelerates the per-tenant list-view default.
            $table->index('created_at', 'customers_created_at_idx');
            $table->index(['client_id', 'created_at'], 'customers_client_created_idx');
        });

        Schema::table('customer_addresses', function (Blueprint $table) {
            // Email/phone duplicate-check on save scans this table by
            // (customer_id, cp_email/cp_contact). We already have
            // customer_id; adding columns for the duplicate-check pass
            // turns it into an index-only scan.
            $table->index(['customer_id', 'cp_email'], 'cust_addr_cust_email_idx');
            $table->index(['customer_id', 'cp_contact'], 'cust_addr_cust_phone_idx');
        });
    }

    public function down(): void
    {
        Schema::table('customers', function (Blueprint $table) {
            $table->dropIndex('customers_created_by_idx');
            $table->dropIndex('customers_created_at_idx');
            $table->dropIndex('customers_client_created_idx');
        });

        Schema::table('customer_addresses', function (Blueprint $table) {
            $table->dropIndex('cust_addr_cust_email_idx');
            $table->dropIndex('cust_addr_cust_phone_idx');
        });
    }
};
