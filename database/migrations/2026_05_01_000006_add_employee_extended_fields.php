<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Extend the `employees` table to cover every wizard step end-to-end.
 *
 * Step 1 (basic + current address) and Step 2 (job + employment terms)
 * already persist; this migration backfills the rest of the wizard:
 *
 *   - Permanent address  — separate columns so it can differ from current.
 *   - Step 3 (Work Details) — leave / shift / attendance / asset slots.
 *   - Step 4 (Compensation) — payroll config + flags.
 *
 * All columns are nullable to keep existing rows valid.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('employees', function (Blueprint $table) {
            // ── Permanent address ─────────────────────────────────────
            $table->string('perm_address_line1', 255)->nullable()->after('pincode');
            $table->string('perm_address_line2', 255)->nullable()->after('perm_address_line1');
            $table->string('perm_city', 100)->nullable()->after('perm_address_line2');
            $table->unsignedBigInteger('perm_state_id')->nullable()->after('perm_city');
            $table->unsignedBigInteger('perm_country_id')->nullable()->after('perm_state_id');
            $table->string('perm_pincode', 20)->nullable()->after('perm_country_id');

            // ── Step 3: Leave & Attendance ────────────────────────────
            $table->string('leave_plan', 100)->nullable()->after('notice_period_days');
            $table->string('holiday_list', 100)->nullable()->after('leave_plan');
            $table->boolean('attendance_tracking')->default(true)->after('holiday_list');
            $table->string('shift', 50)->nullable()->after('attendance_tracking');
            $table->string('weekly_off', 100)->nullable()->after('shift');
            $table->string('attendance_number', 50)->nullable()->after('weekly_off');
            $table->string('time_tracking', 50)->nullable()->after('attendance_number');
            $table->string('penalization_policy', 100)->nullable()->after('time_tracking');
            $table->string('overtime', 50)->nullable()->after('penalization_policy');
            $table->string('expense_policy', 100)->nullable()->after('overtime');

            // ── Step 3: Asset slots (alongside the existing JSON `assets`
            // column — these are the named primary slots the wizard tracks).
            $table->string('laptop_assigned', 20)->nullable()->after('expense_policy');
            $table->string('laptop_asset_id', 50)->nullable()->after('laptop_assigned');
            $table->string('mobile_device', 100)->nullable()->after('laptop_asset_id');
            $table->string('other_assets', 255)->nullable()->after('mobile_device');

            // ── Step 4: Compensation / Payroll ────────────────────────
            $table->boolean('enable_payroll')->default(true)->after('other_assets');
            $table->string('pay_group', 100)->nullable()->after('enable_payroll');
            $table->decimal('annual_salary', 14, 2)->nullable()->after('pay_group');
            $table->string('salary_frequency', 30)->nullable()->after('annual_salary');
            $table->date('salary_effective_from')->nullable()->after('salary_frequency');
            $table->string('salary_structure', 50)->nullable()->after('salary_effective_from');
            $table->string('tax_regime', 50)->nullable()->after('salary_structure');
            $table->boolean('bonus_in_annual')->default(false)->after('tax_regime');
            $table->boolean('pf_eligible')->default(false)->after('bonus_in_annual');
            $table->boolean('detailed_breakup')->default(false)->after('pf_eligible');
        });
    }

    public function down(): void
    {
        Schema::table('employees', function (Blueprint $table) {
            $table->dropColumn([
                'perm_address_line1', 'perm_address_line2', 'perm_city',
                'perm_state_id', 'perm_country_id', 'perm_pincode',
                'leave_plan', 'holiday_list', 'attendance_tracking',
                'shift', 'weekly_off', 'attendance_number', 'time_tracking',
                'penalization_policy', 'overtime', 'expense_policy',
                'laptop_assigned', 'laptop_asset_id', 'mobile_device', 'other_assets',
                'enable_payroll', 'pay_group', 'annual_salary', 'salary_frequency',
                'salary_effective_from', 'salary_structure', 'tax_regime',
                'bonus_in_annual', 'pf_eligible', 'detailed_breakup',
            ]);
        });
    }
};
