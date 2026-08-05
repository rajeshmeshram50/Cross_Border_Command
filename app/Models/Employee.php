<?php

namespace App\Models;

use App\Models\Masters\Countries;
use App\Models\Masters\Departments;
use App\Models\Masters\Designations;
use App\Models\Masters\Roles;
use App\Models\Masters\States;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Database\Eloquent\SoftDeletes;

class Employee extends Model
{
    use SoftDeletes;

    protected $fillable = [
        'client_id', 'branch_id', 'created_by', 'user_id',
        'emp_code',

        'first_name', 'middle_name', 'last_name', 'display_name',
        'gender', 'date_of_birth', 'blood_group',
        'nationality_country_id', 'work_country_id',
        'email', 'official_email', 'mobile', 'alt_mobile',

        // Current address
        'country_id', 'state_id', 'city',
        'address_line1', 'address_line2', 'pincode',

        // Permanent address (added 2026-05-01)
        'perm_address_line1', 'perm_address_line2', 'perm_city',
        'perm_state_id', 'perm_country_id', 'perm_pincode',

        'legal_entity_id', 'location',
        'department_id', 'designation_id',
        'primary_role_id', 'ancillary_role_id', 'ancillary_role_ids',
        'work_type',
        'reporting_manager_id', 'reporting_manager_user_id', 'has_prior_experience', 'date_of_joining',

        'probation_policy', 'probation_months', 'probation_end_date', 'probation_completion_emailed_at',
        'notice_period', 'notice_period_days',

        // Step 3 — Work Details (added 2026-05-01)
        'leave_plan', 'holiday_list', 'holiday_group_id', 'attendance_tracking',
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
        // Face-biometric attendance (added 2026-05-12).
        'face_descriptor', 'face_registered_at',
        'face_consent_given_at', 'face_consent_revoked_at',

        // Stage 4 — Payroll & Finance Setup (added 2026-05-03)
        'salary_payment_mode',
        'bank_name', 'bank_account_number', 'ifsc_code',
        'account_holder_name', 'bank_branch', 'bank_account_type',
        'uan_number',
        'pan_number', 'pf_deduction', 'pf_type', 'esi_applicable',
        'gratuity_nominee_name', 'agreed_ctc_lpa',
        'stage4_completed_at',

        'assets', 'status', 'wizard_step_completed', 'onboarding_stage_completed',
    ];

    /** Accessors auto-included on every JSON serialization. The
     *  `other_assets_resolved` accessor short-circuits when the array
     *  is empty, so rows without assets pay no DB cost.
     *  `photo_url` resolves the passport-size photo uploaded as an
     *  EmployeeDocument with document_key='photo' — eager-load
     *  `photoDocument` to avoid N+1 on list endpoints. */
    protected $appends = ['other_assets_resolved', 'ancillary_roles_resolved', 'photo_url', 'face_registered', 'encrypted_id', 'profile_completion'];

    /** Never ship the raw 128-d descriptor on list/detail responses.
     *  It's biometric data, ~1.5 KB per row, and the only legitimate
     *  reader is the auth flow which fetches it directly from the DB. */
    protected $hidden = ['face_descriptor'];

    protected $casts = [
        'date_of_birth'  => 'date',
        'date_of_joining' => 'date',
        'salary_effective_from' => 'date',
        'assets' => 'array',
        'other_master_asset_ids' => 'array',
        'ancillary_role_ids' => 'array',
        'probation_months' => 'integer',
        // Computed on the frontend from joining date + probation policy.
        'probation_end_date' => 'date',
        'probation_completion_emailed_at' => 'datetime',
        'notice_period_days' => 'integer',
        'attendance_tracking' => 'boolean',
        'enable_payroll' => 'boolean',
        'has_prior_experience' => 'boolean',
        'bonus_in_annual' => 'boolean',
        'pf_eligible' => 'boolean',
        'detailed_breakup' => 'boolean',
        'annual_salary' => 'decimal:2',
        'face_descriptor'          => 'array',
        'face_registered_at'       => 'datetime',
        'face_consent_given_at'    => 'datetime',
        'face_consent_revoked_at'  => 'datetime',
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

    /** Terminal statuses that disable the login + freeze profile activity. */
    public const DISABLED_STATUSES = ['inactive', 'resigned', 'terminated'];

    /**
     * A "disabled" employee is one whose login is off — either soft-deleted
     * (the Remove action) or sitting in a terminal status (Inactive/Resigned/
     * Terminated). Profile-write actions (edit, documents, face enrolment,
     * etc.) must be refused for these until they're restored/re-activated.
     * Shared by every controller that mutates an employee's profile so the
     * rule stays consistent across the app.
     */
    public function isDisabled(): bool
    {
        return $this->trashed()
            || in_array(strtolower((string) $this->status), self::DISABLED_STATUSES, true);
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

    /**
     * Resolve the assigned shift into a ["HH:MM" start, "HH:MM" end] window.
     *
     * The `shift` column stores only the shift NAME (e.g. "General") — the
     * actual timings live on the branch's `shifts` repeater ({name,start,end}).
     * Late-mark detection and payroll LOP must use the ACTUAL assigned timing,
     * so we resolve name → branch shift here instead of trying to read a time
     * out of the bare name (which always failed and fell back to 09:30).
     * Resolution order:
     *   1. a "HH:MM–HH:MM" range embedded in the shift string (legacy values),
     *   2. the branch shift row whose name matches `shift`,
     *   3. [null, null] → callers apply the 09:30–18:30 office default.
     *
     * Eager-load `branch:id,shifts` on list endpoints to avoid an N+1.
     */
    public function resolveShiftWindow(): array
    {
        $shift = trim((string) ($this->shift ?? ''));
        if ($shift === '') {
            return [null, null];
        }

        // 1. Time range already embedded in the value.
        if (preg_match('/(\d{1,2}:\d{2})\s*[–\-]\s*(\d{1,2}:\d{2})/u', $shift, $m)) {
            return [$m[1], $m[2]];
        }

        // 2. Match the shift NAME against the branch's configured shifts.
        $branch = $this->relationLoaded('branch') ? $this->getRelation('branch') : $this->branch()->first();
        foreach ((array) ($branch->shifts ?? []) as $s) {
            if (strcasecmp(trim((string) ($s['name'] ?? '')), $shift) === 0) {
                $start = $this->hhmm($s['start'] ?? '');
                $end   = $this->hhmm($s['end'] ?? '');
                if ($start) {
                    return [$start, $end];
                }
                break; // name matched but timing unparseable → office default
            }
        }

        // 3. No parseable timing — caller falls back to the office default.
        return [null, null];
    }

    /**
     * Is overtime applicable to this employee?
     *
     * The employee form models this as a Yes/No toggle that, when Yes, forces
     * the pick of an Overtime Rate from Master › Overtime (OT) — so the single
     * `overtime` column carries BOTH facts: a rate name means applicable, blank
     * (or the legacy "Not Applicable" / "No" sentinels the field held before the
     * OT Master existed) means not.
     *
     * Everything overtime-related keys off this: attendance skips the shift-end
     * auto-checkout for these employees so their post-shift time keeps
     * accruing, and payroll only detects OT hours for them.
     */
    public function overtimeApplicable(): bool
    {
        $v = trim((string) ($this->overtime ?? ''));
        return $v !== ''
            && strcasecmp($v, 'Not Applicable') !== 0
            && strcasecmp($v, 'No') !== 0;
    }

    /** First "HH:MM" found in $v, else null. Tolerates "9:30", "09:30:00", "09:30 AM". */
    private function hhmm($v): ?string
    {
        return preg_match('/(\d{1,2}:\d{2})/', (string) $v, $m) ? $m[1] : null;
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

    /** Passport-size photo doc uploaded during onboarding. The
     *  `employee_documents` row with document_key='photo' is the canonical
     *  source — also doubles as the employee's profile picture across the
     *  app (list table avatar, EmployeeProfile hero, profile dropdown). */
    public function photoDocument(): HasOne
    {
        return $this->hasOne(EmployeeDocument::class)->where('document_key', 'photo');
    }

    /**
     * True when this employee has an enrolled face on file. Surfaces in the
     * HR list so admins can see at a glance who has registered vs hasn't,
     * without leaking the raw descriptor. The flag flips back to false
     * after a revoke (which clears both the descriptor and the timestamp).
     */
    public function getFaceRegisteredAttribute(): bool
    {
        return $this->face_registered_at !== null
            && is_array($this->face_descriptor)
            && count($this->face_descriptor) > 0;
    }

    /**
     * Field-based profile completeness (0-100). Counts how many of the
     * "business-card" profile fields are filled, so a created/onboarded
     * employee with real data shows a meaningful % instead of 0% (which the
     * onboarding-stage-only number reported until their wizard advanced).
     * Exposed on the API payload so the HR Onboarding list, HR Employees,
     * and the dashboard all read the SAME dynamic number.
     */
    public function getProfileCompletionAttribute(): int
    {
        // BLENDED completion: 50% from the onboarding-form data fields that
        // are filled + 50% from the HR 6-stage onboarding progress. So a
        // fully-filled record that HR hasn't onboarded yet ("Not Started")
        // tops out at 50% (no longer a misleading 100%), and only a fully
        // onboarded employee with all data reaches 100%.
        //
        // Data half mirrors the fields the onboarding form actually collects
        // (basic → contact → address → job); purely optional fields
        // (middle_name, alt_mobile, address_line2) are excluded so skipping
        // them doesn't unfairly lower the score.
        $fields = [
            // Basic details
            'first_name', 'last_name', 'gender', 'date_of_birth',
            'work_country_id', 'nationality_country_id',
            // Contact & identity
            'email', 'mobile',
            // Address
            'address_line1', 'city', 'state_id', 'country_id', 'pincode',
            // Job
            'department_id', 'designation_id', 'primary_role_id', 'date_of_joining',
        ];
        $hit = 0;
        foreach ($fields as $f) {
            $v = $this->{$f};
            if ($v !== null && $v !== '' && $v !== 0 && $v !== '0') $hit++;
        }
        $dataPart  = ($hit / count($fields)) * 50;
        $stage     = max(0, min(6, (int) ($this->onboarding_stage_completed ?? 0)));
        $stagePart = ($stage / 6) * 50;
        return (int) round($dataPart + $stagePart);
    }

    /**
     * Opaque, URL-safe handle the SPA puts into employee profile links so
     * the real emp_code / DB id isn't visible (or tweakable) in the
     * address bar. Wraps the numeric primary key in Laravel's symmetric
     * Crypt::encryptString — each call produces a fresh ciphertext but
     * decryption always recovers the same integer. The show() route
     * accepts both this token and a plain numeric id, so legacy
     * bookmarks keep working.
     *
     * Note: encryption alone is obfuscation, NOT authorisation —
     * EmployeeController::resolveRow still enforces tenant scope via
     * applyScope, so cross-tenant token guessing returns 404 even when
     * the ciphertext is well-formed.
     */
    public function getEncryptedIdAttribute(): ?string
    {
        if (!$this->id) return null;
        try {
            $enc = \Illuminate\Support\Facades\Crypt::encryptString((string) $this->id);
            // Laravel's Crypt output is base64 with `+`, `/`, `=` which
            // break route slugs ("/" is a path separator, "+" decodes to
            // space, "=" trails awkwardly). Swap to URL-safe alphabet —
            // strtr is symmetric so the resolver just inverts the map
            // before Crypt::decryptString.
            return rtrim(strtr($enc, '+/', '-_'), '=');
        } catch (\Throwable $e) {
            return null;
        }
    }

    public function getPhotoUrlAttribute(): ?string
    {
        // Use the eager-loaded relation when present; fall back to a single
        // lookup on detail views where eager-loading isn't worth it.
        $doc = $this->relationLoaded('photoDocument')
            ? $this->photoDocument
            : $this->photoDocument()->first();
        return $doc ? file_url($doc->file_path) : null;
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

    /**
     * Resolve the JSON-array of ancillary role ids into role rows so the
     * SPA can render the chip + "+N" badge directly. Falls back to the
     * legacy `ancillary_role_id` for rows that haven't been re-saved
     * since the multi-role migration.
     */
    public function getAncillaryRolesResolvedAttribute(): \Illuminate\Support\Collection
    {
        $ids = (array) ($this->ancillary_role_ids ?? []);
        if (empty($ids) && $this->ancillary_role_id) {
            $ids = [$this->ancillary_role_id];
        }
        if (empty($ids)) return collect();
        return \App\Models\Masters\Roles::query()
            ->whereIn('id', $ids)
            ->get(['id', 'name'])
            // Preserve the user's pick order, not the DB's natural order.
            ->sortBy(fn ($r) => array_search($r->id, $ids))
            ->values();
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

    // Permanent-address relations — column pair mirrors the current-address
    // country_id / state_id so the profile view can render both blocks
    // without an extra round-trip per row.
    public function permCountry(): BelongsTo
    {
        return $this->belongsTo(Countries::class, 'perm_country_id');
    }

    public function permState(): BelongsTo
    {
        return $this->belongsTo(States::class, 'perm_state_id');
    }

    /**
     * The employing legal entity — a BRANCH, not a master_legal_entities row.
     * The branch carries the GST/PAN/CIN/IEC and bank accounts, so it is the
     * registered entity an employee is hired into. Repointed by the
     * 2026_07_30_000020 migration; the column name is kept for continuity.
     */
    public function legalEntity(): BelongsTo
    {
        return $this->belongsTo(Branch::class, 'legal_entity_id');
    }

    public function department(): BelongsTo
    {
        return $this->belongsTo(Departments::class, 'department_id');
    }

    public function designation(): BelongsTo
    {
        return $this->belongsTo(Designations::class, 'designation_id');
    }

    public function holidayGroup(): BelongsTo
    {
        return $this->belongsTo(HolidayGroup::class, 'holiday_group_id');
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

    /**
     * Manager → a login User (Client/Branch user who hasn't been
     * onboarded as an Employee row). Only ONE of `reporting_manager_id`
     * or `reporting_manager_user_id` is populated per employee — the
     * controller picks which based on the picker's `kind`.
     */
    public function reportingManagerUser(): BelongsTo
    {
        return $this->belongsTo(\App\Models\User::class, 'reporting_manager_user_id');
    }

    /**
     * The exit record for this employee (notice_date, last_working_day,
     * reason, etc.). At most one row per employee — `employee_exits`
     * carries a UNIQUE constraint on `employee_id`. Eager-loaded on the
     * Employee list/detail JSON so HrExitManagement.tsx can read
     * `last_working_day` directly off the row without a second call.
     */
    public function exit(): \Illuminate\Database\Eloquent\Relations\HasOne
    {
        return $this->hasOne(\App\Models\EmployeeExit::class, 'employee_id');
    }

    /* ── Payroll graph ─────────────────────────────────────────────────
     * Reverse links so payroll (and any other feature) can traverse from an
     * employee to their attendance / leave / salary / payslips. The payroll
     * engine reads via these inputs; keeping the relationships here makes the
     * data model explicit and lets callers eager-load.
     */
    public function attendances(): \Illuminate\Database\Eloquent\Relations\HasMany
    {
        return $this->hasMany(\App\Models\Attendance::class, 'employee_id');
    }

    public function previousEmployments(): \Illuminate\Database\Eloquent\Relations\HasMany
    {
        return $this->hasMany(\App\Models\PreviousEmployment::class, 'employee_id');
    }

    public function leaveRequests(): \Illuminate\Database\Eloquent\Relations\HasMany
    {
        return $this->hasMany(\App\Models\LeaveRequest::class, 'employee_id');
    }

    public function salaryStructures(): \Illuminate\Database\Eloquent\Relations\HasMany
    {
        return $this->hasMany(\App\Models\SalaryStructure::class, 'employee_id');
    }

    /** The one currently-active salary structure (Rule 5/19). */
    public function activeSalaryStructure(): \Illuminate\Database\Eloquent\Relations\HasOne
    {
        return $this->hasOne(\App\Models\SalaryStructure::class, 'employee_id')
            ->where('status', 'active')
            ->latest('effective_from');
    }

    public function payslips(): \Illuminate\Database\Eloquent\Relations\HasMany
    {
        return $this->hasMany(\App\Models\Payslip::class, 'employee_id');
    }
}
