<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Versioned salary structure per employee (Rule 5 + Rule 19).
 *
 * An employee can have many structure rows but only ONE `active` at a time.
 * Revising a salary does NOT overwrite the prior row — it supersedes it and
 * inserts a new version with its own `effective_from`, so historical payslips
 * can always be reconstructed against the structure that was live at the time.
 *
 * `earnings` / `deductions` are JSON component lists:
 *   [{ "code": "basic", "label": "Basic Salary", "amount": 50000 }, ...]
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('salary_structures', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('client_id')->nullable()->index();
            $table->unsignedBigInteger('branch_id')->nullable()->index();
            $table->unsignedBigInteger('employee_id')->index();

            $table->unsignedInteger('version')->default(1);
            $table->date('effective_from');

            // draft → active → superseded. Only one active per employee.
            $table->enum('status', ['draft', 'active', 'superseded'])->default('active');

            // Component breakdown (JSON arrays of {code,label,amount}).
            $table->json('earnings')->nullable();
            $table->json('deductions')->nullable();

            // Denormalised monthly totals so list/aggregation queries don't have
            // to sum the JSON every time.
            $table->decimal('monthly_gross', 14, 2)->default(0);
            $table->decimal('monthly_ctc', 14, 2)->default(0);

            // Statutory applicability toggles (Rule 8 / 9).
            $table->boolean('pf_applicable')->default(false);
            $table->boolean('esi_applicable')->default(false);
            $table->boolean('pt_applicable')->default(true);

            // Rule 19 — approval metadata on the version itself.
            $table->enum('approval_status', ['draft', 'approved'])->default('approved');
            $table->unsignedBigInteger('approved_by')->nullable();
            $table->timestamp('approved_at')->nullable();
            $table->text('revision_note')->nullable();

            $table->unsignedBigInteger('created_by')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->index(['client_id', 'employee_id', 'status'], 'salary_structures_emp_status_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('salary_structures');
    }
};
