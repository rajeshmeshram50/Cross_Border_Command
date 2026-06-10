<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * HRMS — Holiday calendar. Per-tenant list of company holidays / closure
 * dates surfaced to employees. Manually entered or bulk-imported from Excel.
 *
 * Same tenant + scoping conventions as announcements / leave plans:
 * client_id + branch_id nullable & indexed, no DB-level FKs (matches the
 * rest of the HR/masters tables), soft deletes, audit columns.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('holidays', function (Blueprint $table) {
            $table->id();

            // Tenant + ownership — scoped exactly like announcements.
            $table->unsignedBigInteger('client_id')->nullable()->index();
            $table->unsignedBigInteger('branch_id')->nullable()->index();
            $table->unsignedBigInteger('created_by')->nullable();
            $table->unsignedBigInteger('updated_by')->nullable();

            // HOL-#### per tenant, auto-allocated like ANN- / REC-.
            $table->string('code', 20)->nullable()->index();

            $table->string('name', 191);
            $table->date('date');
            // Public | Restricted | Company | Regional — kept as a plain string
            // (not enum) so adding a category later doesn't need a migration.
            $table->string('type', 30)->default('Public');
            // Repeats on the same calendar date every year (e.g. Independence Day).
            $table->boolean('is_recurring')->default(false);
            $table->text('description')->nullable();

            $table->timestamps();
            $table->softDeletes();

            $table->index(['client_id', 'branch_id', 'date'], 'holidays_tenant_date_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('holidays');
    }
};
