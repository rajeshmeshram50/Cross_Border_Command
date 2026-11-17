<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Payroll Execution Tracking & Audit Log.
 *
 * One Branch Admin login is shared by several people, so `created_by` only ever
 * says "the branch admin" and never says WHO. The disbursement popup already
 * asks the operator to name themselves in "Payroll Run By" — the answer was
 * sent to the server and dropped on the floor. This is where it lands.
 *
 * APPEND-ONLY by intent: a re-run writes a NEW row rather than updating the
 * last one, so the history shows every execution of a cycle and not just the
 * most recent. Nothing in the app updates or deletes these rows.
 *
 * The operator's name and code are SNAPSHOTTED, not joined at read time: this
 * is an audit record, and it has to keep saying who ran payroll in September
 * even after that person is renamed, transferred or offboarded.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('payroll_execution_logs', function (Blueprint $table) {
            $table->id();

            // Tenancy — scoped the same way every payroll read is.
            $table->unsignedBigInteger('client_id')->nullable()->index();
            $table->unsignedBigInteger('branch_id')->nullable()->index();

            // Which execution this was.
            $table->unsignedBigInteger('payroll_run_id')->nullable()->index();
            $table->unsignedBigInteger('payroll_period_id')->nullable()->index();
            // Denormalised so the history groups by month without joining a
            // period row that may later be reopened or relabelled.
            $table->smallInteger('month')->nullable();
            $table->smallInteger('year')->nullable();
            $table->string('period_label', 40)->nullable();

            /* WHO — as named in the dropdown, snapshotted. */
            $table->unsignedBigInteger('run_by_employee_id')->nullable()->index();
            $table->string('run_by_employee_code', 60)->nullable();
            $table->string('run_by_name', 191)->nullable();

            /* …and the login that was actually used, which is the shared one.
               Kept beside the declared operator rather than instead of it: the
               whole point is that the two differ. */
            $table->unsignedBigInteger('executed_by_user_id')->nullable()->index();
            $table->string('executed_by_user_name', 191)->nullable();

            // Completed | In Progress | Failed
            $table->string('status', 20)->default('Completed')->index();
            $table->string('failure_reason', 500)->nullable();

            /* WHEN — a single timestamp. The spec asks for a date column and a
               time column, but storing them apart invites them to disagree and
               makes "the last run before X" unanswerable; the UI formats one
               instant into the two columns instead. */
            $table->timestamp('executed_at')->nullable()->index();

            // What the execution actually did, so a row stands on its own.
            $table->string('batch_ref', 60)->nullable();
            $table->integer('employees_paid')->nullable();
            $table->integer('employees_held')->nullable();
            $table->decimal('total_amount', 14, 2)->nullable();

            $table->timestamps();

            // The history is read one tenant + cycle at a time, newest first.
            $table->index(['client_id', 'branch_id', 'year', 'month'], 'pel_scope_period_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('payroll_execution_logs');
    }
};
