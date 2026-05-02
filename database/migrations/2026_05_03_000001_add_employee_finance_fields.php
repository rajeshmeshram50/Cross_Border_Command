<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Stage 4 — Payroll & Finance Setup.
 *
 * Stage 1's wizard already persists the compensation structure (annual
 * salary, frequency, tax regime, PF flag, bonus inclusion). Stage 4
 * captures the *finance side* of that compensation: where the salary
 * lands, the statutory identifiers needed by payroll, and a soft
 * "stage completed at" stamp the modal uses to gate Next Stage.
 *
 * All columns nullable so partial saves keep working.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('employees', function (Blueprint $table) {
            // Salary disbursement mode — bank | cheque | cash.
            $table->string('salary_payment_mode', 20)->default('bank')->after('detailed_breakup');

            // Bank account (only required when salary_payment_mode === 'bank',
            // but stored nullable so Stage 4 can save partial drafts).
            $table->string('bank_name', 150)->nullable()->after('salary_payment_mode');
            $table->string('bank_account_number', 30)->nullable()->after('bank_name');
            $table->string('ifsc_code', 20)->nullable()->after('bank_account_number');
            $table->string('account_holder_name', 150)->nullable()->after('ifsc_code');
            $table->string('bank_branch', 150)->nullable()->after('account_holder_name');
            $table->string('bank_account_type', 30)->nullable()->after('bank_branch');
            $table->string('uan_number', 20)->nullable()->after('bank_account_type');

            // Tax & statutory identifiers.
            $table->string('pan_number', 15)->nullable()->after('uan_number');
            $table->string('pf_deduction', 50)->nullable()->after('pan_number');
            $table->string('esi_applicable', 5)->nullable()->after('pf_deduction');
            $table->string('gratuity_nominee_name', 150)->nullable()->after('esi_applicable');
            $table->decimal('agreed_ctc_lpa', 14, 2)->nullable()->after('gratuity_nominee_name');

            // Stage 4 completion marker. Stamped when admin saves the stage
            // explicitly. Cleared if re-edited but never auto-decremented —
            // the modal's high-watermark logic protects forward progress.
            $table->timestamp('stage4_completed_at')->nullable()->after('agreed_ctc_lpa');
        });
    }

    public function down(): void
    {
        Schema::table('employees', function (Blueprint $table) {
            $table->dropColumn([
                'salary_payment_mode',
                'bank_name', 'bank_account_number', 'ifsc_code',
                'account_holder_name', 'bank_branch', 'bank_account_type',
                'uan_number',
                'pan_number', 'pf_deduction', 'esi_applicable',
                'gratuity_nominee_name', 'agreed_ctc_lpa',
                'stage4_completed_at',
            ]);
        });
    }
};
