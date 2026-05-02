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

        // Stage 1 Step 3 — asset assignments (added 2026-05-03). FKs into
        // master_assets; uniqueness across employees enforced in
        // EmployeeController so the same physical device can't be issued
        // to two people at once.
        'laptop_master_asset_id', 'mobile_master_asset_id', 'other_master_asset_ids',

        // Stage 3 — Physical Setup & Identification (added 2026-05-03).
        'biometric_status', 'desk_workstation_no', 'id_card_status',

        // Stage 4 — Payroll & Finance Setup (added 2026-05-03)
        'salary_payment_mode',
        'bank_name', 'bank_account_number', 'ifsc_code',
        'account_holder_name', 'bank_branch', 'bank_account_type',
        'uan_number',
        'pan_number', 'pf_deduction', 'esi_applicable',
        'gratuity_nominee_name', 'agreed_ctc_lpa',
        'stage4_completed_at',

        'assets', 'status', 'wizard_step_completed', 'onboarding_stage_completed',
    ];

    /** Accessors auto-included on every JSON serialization. The
     *  `other_assets_resolved` accessor short-circuits when the array
     *  is empty, so rows without assets pay no DB cost. */
    protected $appends = ['other_assets_resolved'];

    protected $casts = [
        'date_of_birth'  => 'date',
        'date_of_joining' => 'date',
        'salary_effective_from' => 'date',
        'assets' => 'array',
        'other_master_asset_ids' => 'array',
        'probation_months' => 'integer',
        'notice_period_days' => 'integer',
        'attendance_tracking' => 'boolean',
        'enable_payroll' => 'boolean',
        'bonus_in_annual' => 'boolean',
        'pf_eligible' => 'boolean',
        'detailed_breakup' => 'boolean',
        'annual_salary' => 'decimal:2',
        'agreed_ctc_lpa' => 'decimal:2',
        'stage4_completed_at' => 'datetime',
        'wizard_step_completed' => 'integer',
        'onboarding_stage_completed' => 'integer',
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

    // ── Asset assignments (Stage 1 Step 3) ──────────────────────────────
    // Single-row FKs go through plain BelongsTo; the `other_master_asset_ids`
    // array is exposed via the `other_assets_resolved` accessor so the
    // controller can return one consistent shape regardless of column type.

    public function laptopAsset(): BelongsTo
    {
        return $this->belongsTo(\App\Models\Masters\Assets::class, 'laptop_master_asset_id');
    }

    public function mobileAsset(): BelongsTo
    {
        return $this->belongsTo(\App\Models\Masters\Assets::class, 'mobile_master_asset_id');
    }

    /** Resolve the JSON-array of master_asset ids into full asset rows. */
    public function getOtherAssetsResolvedAttribute(): \Illuminate\Support\Collection
    {
        $ids = (array) ($this->other_master_asset_ids ?? []);
        if (empty($ids)) return collect();
        return \App\Models\Masters\Assets::query()
            ->whereIn('id', $ids)
            ->get(['id', 'asset_name', 'code', 'asset_number']);
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
