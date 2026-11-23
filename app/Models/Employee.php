<?php

namespace App\Models;

use App\Support\Concerns\EnforcesUniqueEmail;
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
    use EnforcesUniqueEmail;
    protected static string $emailScope   = 'employee';
    protected static array  $emailColumns = ['email', 'official_email'];

    use SoftDeletes;

    protected static function booted(): void
    {
        static::saving(function (self $employee) {
            if (!$employee->exists || !$employee->isDirty('designation_id')) return;

            $before = $employee->getOriginal('designation_id');
            $after  = $employee->designation_id;

            if ($before === null || $after === null || (int) $before === (int) $after) return;

            $employee->previous_designation_id = $before;
            $employee->designation_changed_at  = now();
        });
    }

    protected $fillable = [
        'client_id',
        'branch_id',
        'created_by',
        'user_id',
        'emp_code',

        'first_name',
        'middle_name',
        'last_name',
        'display_name',
        'gender',
        'date_of_birth',
        'blood_group',
        'nationality_country_id',
        'work_country_id',
        'email',
        'official_email',
        'mobile',
        'alt_mobile',

        'country_id',
        'state_id',
        'city',
        'address_line1',
        'address_line2',
        'pincode',

        'perm_address_line1',
        'perm_address_line2',
        'perm_city',
        'perm_state_id',
        'perm_country_id',
        'perm_pincode',

        'legal_entity_id',
        'location',
        'department_id',
        'designation_id',
        'primary_role_id',
        'ancillary_role_id',
        'ancillary_role_ids',
        'work_type',
        'employee_type',
        'reporting_manager_id',
        'reporting_manager_user_id',
        'has_prior_experience',
        'date_of_joining',

        'probation_policy',
        'probation_months',
        'probation_end_date',
        'probation_completion_emailed_at',
        'notice_period',
        'notice_period_days',

        'leave_plan',
        'holiday_list',
        'holiday_group_id',
        'attendance_tracking',
        'shift',
        'weekly_off',
        'attendance_number',
        'time_tracking',
        'penalization_policy',
        'overtime',
        'expense_policy',
        'laptop_assigned',
        'laptop_asset_id',
        'mobile_device',
        'mobile_assigned',
        'other_assets',

        'enable_payroll',
        'pay_group',
        'annual_salary',
        'salary_frequency',
        'salary_effective_from',
        'salary_structure',
        'tax_regime',
        'bonus_in_annual',
        'pf_eligible',
        'detailed_breakup',

        'laptop_master_asset_id',
        'mobile_master_asset_id',
        'other_master_asset_ids',

        'biometric_status',
        'desk_workstation_no',
        'id_card_status',
        'face_descriptor',
        'face_registered_at',
        'face_consent_given_at',
        'face_consent_revoked_at',

        'salary_payment_mode',
        'bank_name',
        'bank_account_number',
        'ifsc_code',
        'account_holder_name',
        'bank_branch',
        'bank_account_type',
        'uan_number',
        'pan_number',
        'pf_deduction',
        'pf_type',
        'esi_applicable',
        'gratuity_nominee_name',
        'agreed_ctc_lpa',
        'stage4_completed_at',

        'assets',
        'status',
        'wizard_step_completed',
        'onboarding_stage_completed',
    ];

    protected $appends = ['other_assets_resolved', 'ancillary_roles_resolved', 'photo_url', 'face_registered', 'encrypted_id', 'profile_completion'];

    protected $hidden = ['face_descriptor', 'photoDocument'];

    protected $casts = [
        'date_of_birth'  => 'date',
        'date_of_joining' => 'date',
        'salary_effective_from' => 'date',
        'assets' => 'array',
        'other_master_asset_ids' => 'array',
        'ancillary_role_ids' => 'array',
        'probation_months' => 'integer',
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
        'designation_changed_at' => 'datetime',
    ];

    public static function composeDisplayName(?string $first, ?string $middle, ?string $last): string
    {
        return trim(preg_replace('/\s+/', ' ', trim(($first ?? '') . ' ' . ($middle ?? '') . ' ' . ($last ?? ''))));
    }

    public const DISABLED_STATUSES = ['inactive', 'resigned', 'terminated'];

    public function isDisabled(): bool
    {
        return $this->trashed()
            || in_array(strtolower((string) $this->status), self::DISABLED_STATUSES, true);
    }

    public function client(): BelongsTo
    {
        return $this->belongsTo(Client::class);
    }

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    public function resolveShiftWindow(): array
    {
        $shift = trim((string) ($this->shift ?? ''));
        if ($shift === '') {
            return [null, null];
        }

        if (preg_match('/(\d{1,2}:\d{2})\s*[–\-]\s*(\d{1,2}:\d{2})/u', $shift, $m)) {
            return [$m[1], $m[2]];
        }

        $branch = $this->relationLoaded('branch') ? $this->getRelation('branch') : null;
        if (!$branch || !array_key_exists('shifts', $branch->getAttributes())) {
            $branch = $this->branch()->first();
        }
        if (!$branch) {
            return [null, null];
        }
        foreach ((array) ($branch->shifts ?? []) as $s) {
            if (strcasecmp(trim((string) ($s['name'] ?? '')), $shift) === 0) {
                $start = $this->hhmm($s['start'] ?? '');
                $end   = $this->hhmm($s['end'] ?? '');
                if ($start) {
                    return [$start, $end];
                }
                break;
            }
        }

        return [null, null];
    }

    public function overtimeApplicable(): bool
    {
        $v = trim((string) ($this->overtime ?? ''));
        return $v !== ''
            && strcasecmp($v, 'Not Applicable') !== 0
            && strcasecmp($v, 'No') !== 0;
    }

    private function hhmm($v): ?string
    {
        return preg_match('/(\d{1,2}:\d{2})/', (string) $v, $m) ? $m[1] : null;
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_id');
    }

    public function getResolvedUserIdAttribute(): ?int
    {
        if ($this->user_id) return (int) $this->user_id;
        if (empty($this->emp_code)) return null;

        if (!array_key_exists('resolvedUserId', $this->relations)) {
            $id = User::where('employee_code', $this->emp_code)
                ->when($this->client_id, fn ($q) => $q->where('client_id', $this->client_id))
                ->value('id');
            $this->relations['resolvedUserId'] = $id ? (int) $id : null;
        }

        return $this->relations['resolvedUserId'];
    }

    public function photoDocument(): HasOne
    {
        return $this->hasOne(EmployeeDocument::class)->where('document_key', 'photo');
    }

    public function getFaceRegisteredAttribute(): bool
    {
        return $this->face_registered_at !== null
            && is_array($this->face_descriptor)
            && count($this->face_descriptor) > 0;
    }

    public function getProfileCompletionAttribute(): int
    {
        $fields = [
            'first_name',
            'last_name',
            'gender',
            'date_of_birth',
            'work_country_id',
            'nationality_country_id',
            'email',
            'mobile',
            'address_line1',
            'city',
            'state_id',
            'country_id',
            'pincode',
            'department_id',
            'designation_id',
            'primary_role_id',
            'date_of_joining',
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

    public function getEncryptedIdAttribute(): ?string
    {
        if (!$this->id) return null;
        try {
            $enc = \Illuminate\Support\Facades\Crypt::encryptString((string) $this->id);
            return rtrim(strtr($enc, '+/', '-_'), '=');
        } catch (\Throwable $e) {
            return null;
        }
    }

    public function getPhotoUrlAttribute(): ?string
    {
        $doc = $this->relationLoaded('photoDocument')
            ? $this->photoDocument
            : $this->photoDocument()->first();
        return $doc ? file_url($doc->file_path) : null;
    }

    public function laptopAsset(): BelongsTo
    {
        return $this->belongsTo(\App\Models\Masters\Assets::class, 'laptop_master_asset_id');
    }

    public function mobileAsset(): BelongsTo
    {
        return $this->belongsTo(\App\Models\Masters\Assets::class, 'mobile_master_asset_id');
    }

    public function getOtherAssetsResolvedAttribute($value = null): \Illuminate\Support\Collection
    {
        if ($value instanceof \Illuminate\Support\Collection) return $value;

        $ids = (array) ($this->other_master_asset_ids ?? []);
        if (empty($ids)) return collect();
        return \App\Models\Masters\Assets::query()
            ->whereIn('id', $ids)
            ->get(['id', 'asset_name', 'code', 'asset_number'])
            ->sortBy(fn($a) => array_search($a->id, $ids))
            ->values();
    }

    public function getAncillaryRolesResolvedAttribute($value = null): \Illuminate\Support\Collection
    {
        if ($value instanceof \Illuminate\Support\Collection) return $value;

        $ids = (array) ($this->ancillary_role_ids ?? []);
        if (empty($ids) && $this->ancillary_role_id) {
            $ids = [$this->ancillary_role_id];
        }
        if (empty($ids)) return collect();
        return \App\Models\Masters\Roles::query()
            ->whereIn('id', $ids)
            ->get(['id', 'name'])
            ->sortBy(fn($r) => array_search($r->id, $ids))
            ->values();
    }

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

    public function permCountry(): BelongsTo
    {
        return $this->belongsTo(Countries::class, 'perm_country_id');
    }

    public function permState(): BelongsTo
    {
        return $this->belongsTo(States::class, 'perm_state_id');
    }

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

    public function reportingManager(): BelongsTo
    {
        return $this->belongsTo(self::class, 'reporting_manager_id');
    }

    public function reportingManagerUser(): BelongsTo
    {
        return $this->belongsTo(\App\Models\User::class, 'reporting_manager_user_id');
    }

    public function directReports(): \Illuminate\Database\Eloquent\Relations\HasMany
    {
        return $this->hasMany(self::class, 'reporting_manager_id');
    }

    public function exit(): \Illuminate\Database\Eloquent\Relations\HasOne
    {
        return $this->hasOne(\App\Models\EmployeeExit::class, 'employee_id');
    }

    public function attendances(): \Illuminate\Database\Eloquent\Relations\HasMany
    {
        return $this->hasMany(\App\Models\Attendance::class, 'employee_id');
    }

    public function previousEmployments(): \Illuminate\Database\Eloquent\Relations\HasMany
    {
        return $this->hasMany(\App\Models\PreviousEmployment::class, 'employee_id')
            ->orderByDesc('start_date');
    }

    public function leaveRequests(): \Illuminate\Database\Eloquent\Relations\HasMany
    {
        return $this->hasMany(\App\Models\LeaveRequest::class, 'employee_id');
    }

    public function salaryStructures(): \Illuminate\Database\Eloquent\Relations\HasMany
    {
        return $this->hasMany(\App\Models\SalaryStructure::class, 'employee_id');
    }

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
