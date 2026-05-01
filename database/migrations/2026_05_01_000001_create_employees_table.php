<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Employee master — one row per person on the org.
 *
 * Tenant scoping mirrors the rest of the master tables (client_id, branch_id),
 * and the auto-numbered `emp_code` (EMP-001, EMP-002, …) restarts per tenant
 * tuple so each client/branch has its own numbering series.
 *
 * `user_id` points at the `users` row created during onboarding so the
 * employee can log into the dashboard. It's nullable for the rare case where
 * we want to record an employee but not provision login (e.g. external/partner).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('employees', function (Blueprint $table) {
            $table->id();

            // Tenant + ownership
            $table->unsignedBigInteger('client_id')->nullable()->index();
            $table->unsignedBigInteger('branch_id')->nullable()->index();
            $table->unsignedBigInteger('created_by')->nullable();

            // Linked login account (employees log in to the dashboard with their
            // own credentials, just like branch_user / client_admin).
            $table->unsignedBigInteger('user_id')->nullable()->unique();

            // Auto-generated identifier — EMP-001 per tenant, max 20 chars.
            $table->string('emp_code', 20)->nullable()->index();

            // ── Step 1: Personal / Identity ───────────────────────────
            $table->string('first_name', 100);
            $table->string('middle_name', 100)->nullable();
            $table->string('last_name', 100)->nullable();
            // Cached "First Middle Last" for quick search & list display.
            $table->string('display_name', 255)->nullable()->index();
            $table->enum('gender', ['Male', 'Female', 'Other'])->nullable();
            $table->date('date_of_birth')->nullable();
            $table->unsignedBigInteger('nationality_country_id')->nullable()->index();
            $table->unsignedBigInteger('work_country_id')->nullable()->index();

            // Contact (also used for login email)
            $table->string('email', 191)->nullable()->index();
            $table->string('mobile', 30)->nullable();
            $table->string('alt_mobile', 30)->nullable();

            // ── Step 2: Address ───────────────────────────────────────
            $table->unsignedBigInteger('country_id')->nullable()->index();
            $table->unsignedBigInteger('state_id')->nullable()->index();
            $table->string('city', 100)->nullable();
            $table->string('address_line1', 255)->nullable();
            $table->string('address_line2', 255)->nullable();
            $table->string('pincode', 20)->nullable();

            // ── Step 3: Job / Org ─────────────────────────────────────
            $table->unsignedBigInteger('legal_entity_id')->nullable()->index();
            $table->string('location', 191)->nullable();    // populated from legal entity, editable
            $table->unsignedBigInteger('department_id')->nullable()->index();
            $table->unsignedBigInteger('designation_id')->nullable()->index();
            $table->unsignedBigInteger('primary_role_id')->nullable()->index();
            $table->unsignedBigInteger('ancillary_role_id')->nullable()->index();
            // Self-FK: a manager is also an employee.
            $table->unsignedBigInteger('reporting_manager_id')->nullable()->index();
            $table->date('date_of_joining')->nullable();

            // Policies
            $table->string('probation_policy', 50)->nullable();   // preset name OR "Custom"
            $table->integer('probation_months')->nullable();
            $table->string('notice_period', 50)->nullable();      // preset name OR "Custom"
            $table->integer('notice_period_days')->nullable();

            // ── Step 4: Assets ─────────────────────────────────────────
            // Free-form list of asset ids selected from master_assets. JSON
            // keeps it simple; if asset assignments grow lifecycle metadata
            // (issued_at, returned_at, condition…) promote to a pivot table.
            $table->json('assets')->nullable();

            // Status
            $table->enum('status', [
                'Active', 'Inactive', 'On Leave', 'Probation',
                'Notice Period', 'Resigned', 'Terminated',
            ])->default('Active');

            $table->timestamps();
            $table->softDeletes();

            // Composite index — list/search queries always filter by tenant first.
            $table->index(['client_id', 'branch_id', 'status'], 'employees_tenant_status_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('employees');
    }
};
