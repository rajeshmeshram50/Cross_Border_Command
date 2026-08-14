<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Rule 21 — persisted Full & Final settlements.
 *
 * FnF has been computed live on every GET and thrown away: the HR-decided
 * inputs (encashment days, notice recovery, other dues) lived only in the query
 * string, so reopening the screen lost them, two people could read different
 * numbers for the same settlement, and there was no record of what was actually
 * paid — the one figure an exited employee is most likely to dispute later.
 *
 * This stores the settlement as a document: the inputs HR chose, the full
 * computed breakdown at the moment it was saved, and a status it moves through.
 * The breakdown is snapshotted rather than recomputed on read for the same
 * reason payslips are — a salary structure revision months later must not
 * silently restate a settlement that has already been paid.
 *
 * The GET preview endpoint is unchanged and still computes live; this table
 * only holds settlements someone deliberately saved.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('fnf_settlements', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('client_id')->nullable()->index();
            $table->unsignedBigInteger('branch_id')->nullable()->index();
            $table->unsignedBigInteger('employee_id')->index();
            $table->unsignedBigInteger('employee_exit_id')->nullable()->index();

            $table->string('employee_code', 50)->nullable();
            $table->string('employee_name', 255)->nullable();
            $table->date('last_working_day')->nullable();
            $table->string('exit_type', 100)->nullable();

            // What HR chose, kept separately from the result so a settlement can
            // be reopened and recomputed with the same starting point.
            $table->json('inputs')->nullable();
            // The full computeFnf() breakdown as it stood when saved.
            $table->json('breakdown')->nullable();

            $table->decimal('total_earnings', 14, 2)->default(0);
            $table->decimal('total_deductions', 14, 2)->default(0);
            $table->decimal('net_settlement', 14, 2)->default(0);

            // draft → approved → paid. Only a draft may be recomputed.
            $table->string('status', 20)->default('draft')->index();
            $table->text('notes')->nullable();

            $table->unsignedBigInteger('created_by')->nullable();
            $table->unsignedBigInteger('approved_by')->nullable();
            $table->timestamp('approved_at')->nullable();
            $table->unsignedBigInteger('paid_by')->nullable();
            $table->timestamp('paid_at')->nullable();

            $table->timestamps();
            $table->softDeletes();

            $table->index(['client_id', 'employee_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('fnf_settlements');
    }
};
