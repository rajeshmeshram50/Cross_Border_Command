<?php

namespace App\Models;

use App\Models\Masters\Countries;
use App\Models\Masters\Departments;
use App\Models\Masters\Designations;
use App\Models\Masters\LegalEntities;
use App\Models\Masters\Roles;
use App\Models\Masters\States;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

class Employee extends Model
{
    use SoftDeletes;

    protected $fillable = [
        'client_id', 'branch_id', 'created_by', 'user_id',
        'emp_code',

        'first_name', 'middle_name', 'last_name', 'display_name',
        'gender', 'date_of_birth',
        'nationality_country_id', 'work_country_id',
        'email', 'mobile', 'alt_mobile',

        // Current address
        'country_id', 'state_id', 'city',
        'address_line1', 'address_line2', 'pincode',

        // Permanent address (added 2026-05-01)
        'perm_address_line1', 'perm_address_line2', 'perm_city',
        'perm_state_id', 'perm_country_id', 'perm_pincode',

        'legal_entity_id', 'location',
        'department_id', 'designation_id',
        'primary_role_id', 'ancillary_role_id',
        'reporting_manager_id', 'date_of_joining',

        'probation_policy', 'probation_months',
        'notice_period', 'notice_period_days',

        // Step 3 — Work Details (added 2026-05-01)
        'leave_plan', 'holiday_list', 'attendance_tracking',
        'shift', 'weekly_off', 'attendance_number',
        'time_tracking', 'penalization_policy', 'overtime', 'expense_policy',
        'laptop_assigned', 'laptop_asset_id', 'mobile_device', 'other_assets',

        // Step 4 — Compensation (added 2026-05-01)
        'enable_payroll', 'pay_group', 'annual_salary', 'salary_frequency',
        'salary_effective_from', 'salary_structure', 'tax_regime',
        'bonus_in_annual', 'pf_eligible', 'detailed_breakup',

        'assets', 'status',
    ];

    protected $casts = [
        'date_of_birth'  => 'date',
        'date_of_joining' => 'date',
        'salary_effective_from' => 'date',
        'assets' => 'array',
        'probation_months' => 'integer',
        'notice_period_days' => 'integer',
        'attendance_tracking' => 'boolean',
        'enable_payroll' => 'boolean',
        'bonus_in_annual' => 'boolean',
        'pf_eligible' => 'boolean',
        'detailed_breakup' => 'boolean',
        'annual_salary' => 'decimal:2',
    ];

    /**
     * Build the cached "First Middle Last" string. Trim collapses any double
     * spaces from missing middle/last names.
     */
    public static function composeDisplayName(?string $first, ?string $middle, ?string $last): string
    {
        return trim(preg_replace('/\s+/', ' ', trim(($first ?? '') . ' ' . ($middle ?? '') . ' ' . ($last ?? ''))));
    }

    // ── Tenant / ownership ──────────────────────────────────────────────

    public function client(): BelongsTo
    {
        return $this->belongsTo(Client::class);
    }

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    /** Login account paired to this employee (so they can sign into the dashboard). */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_id');
    }

    // ── Master refs ─────────────────────────────────────────────────────

    public function workCountry(): BelongsTo
    {
        return $this->belongsTo(Countries::class, 'work_country_id');
    }

    public function nationalityCountry(): BelongsTo
    {
        return $this->belongsTo(Countries::class, 'nationality_country_id');
    }

    public function country(): BelongsTo
    {
        return $this->belongsTo(Countries::class, 'country_id');
    }

    public function state(): BelongsTo
    {
        return $this->belongsTo(States::class, 'state_id');
    }

    public function legalEntity(): BelongsTo
    {
        return $this->belongsTo(LegalEntities::class, 'legal_entity_id');
    }

    public function department(): BelongsTo
    {
        return $this->belongsTo(Departments::class, 'department_id');
    }

    public function designation(): BelongsTo
    {
        return $this->belongsTo(Designations::class, 'designation_id');
    }

    public function primaryRole(): BelongsTo
    {
        return $this->belongsTo(Roles::class, 'primary_role_id');
    }

    public function ancillaryRole(): BelongsTo
    {
        return $this->belongsTo(Roles::class, 'ancillary_role_id');
    }

    /** Manager → another Employee row (self-FK, may be null for top-of-tree). */
    public function reportingManager(): BelongsTo
    {
        return $this->belongsTo(self::class, 'reporting_manager_id');
    }
}
