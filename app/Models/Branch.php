<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class Branch extends Model
{
    use SoftDeletes;

    protected $fillable = [
        'client_id',
        'name',
        'code',
        'email',
        'phone',
        'website',
        'contact_person',
        'branch_type',
        'sandwich_policy',
        'industry',
        'description',
        'gst_number',
        'gst_state_code',
        'pan_number',
        'registration_number',
        'cin',
        'iec',
        'drug_license',
        'pcpndt_no',
        'aeo_code',
        'one_star_file_no',
        'one_star_udin_no',
        'logo',
        'signature_path',
        'profile_photo',
        'primary_color',
        'secondary_color',
        'address',
        'city',
        'district',
        'taluka',
        'state',
        'pincode',
        'country',
        'max_users',
        'established_at',
        'status',
        'notes',
        'shifts',
        'late_mark_policy',
        'lop_policy',
        'short_hours_policy',
        'bank_accounts',
        'created_by',
    ];

    protected $appends = ['logo_url', 'profile_photo_url', 'signature_url'];

    protected function casts(): array
    {
        return [
            'max_users' => 'integer',
            'sandwich_policy' => 'boolean',
            'established_at' => 'date',
            'shifts' => 'array',
            'late_mark_policy' => 'array',
            'lop_policy' => 'array',
            'short_hours_policy' => 'array',
            'bank_accounts' => 'array',
        ];
    }

    public const LATE_MARK_DEFAULTS = [
        'enabled'     => true,
        'count'       => 3,
        'deduction'   => 'half_day',
        'consecutive' => false,
    ];

    public const LATE_MARK_DEDUCTIONS = [
        'half_day' => 0.5,
        'full_day' => 1.0,
    ];

    public static function normalizeLateMarkPolicy($value): array
    {
        if (is_string($value)) {
            $decoded = json_decode($value, true);
            $value = is_array($decoded) ? $decoded : null;
        }
        if (!is_array($value)) {
            return self::LATE_MARK_DEFAULTS;
        }

        $count = (int) ($value['count'] ?? self::LATE_MARK_DEFAULTS['count']);
        $countUnusable = $count < 1;
        $count = max(1, min(31, $count));

        $deduction = (string) ($value['deduction'] ?? self::LATE_MARK_DEFAULTS['deduction']);
        if (!array_key_exists($deduction, self::LATE_MARK_DEDUCTIONS)) {
            $deduction = self::LATE_MARK_DEFAULTS['deduction'];
        }

        return [
            'enabled'     => !$countUnusable
                && filter_var($value['enabled'] ?? true, FILTER_VALIDATE_BOOLEAN),
            'count'       => $count,
            'deduction'   => $deduction,
            'consecutive' => filter_var($value['consecutive'] ?? false, FILTER_VALIDATE_BOOLEAN),
        ];
    }

    public const LOP_DEFAULTS = [
        'basis'   => 'gross',
        'divisor' => 'working',
    ];

    public const LOP_BASES    = ['basic', 'gross'];
    public const LOP_DIVISORS = ['calendar', 'working'];

    public static function normalizeLopPolicy($value): array
    {
        if (is_string($value)) {
            $decoded = json_decode($value, true);
            $value = is_array($decoded) ? $decoded : null;
        }
        if (!is_array($value)) {
            return self::LOP_DEFAULTS;
        }

        $basis = strtolower((string) ($value['basis'] ?? self::LOP_DEFAULTS['basis']));
        if (!in_array($basis, self::LOP_BASES, true)) {
            $basis = self::LOP_DEFAULTS['basis'];
        }

        $divisor = strtolower((string) ($value['divisor'] ?? self::LOP_DEFAULTS['divisor']));
        if (!in_array($divisor, self::LOP_DIVISORS, true)) {
            $divisor = self::LOP_DEFAULTS['divisor'];
        }

        return ['basis' => $basis, 'divisor' => $divisor];
    }

    public function lopPolicy(): array
    {
        return self::normalizeLopPolicy($this->lop_policy);
    }

    public static function lopPerDayFor(
        array $policy,
        float $basic,
        float $gross,
        int $calendarDays,
        float $workingDays,
    ): float {
        $policy = self::normalizeLopPolicy($policy);
        $amount = $policy['basis'] === 'gross' ? $gross : $basic;
        $days   = $policy['divisor'] === 'working'
            ? max(1.0, $workingDays)
            : max(1, $calendarDays);

        return round($amount / $days, 4);
    }

    public const SHORT_HOURS_DEFAULTS = [
        'enabled'        => false,
        'half_day_below' => 4.0,
        'absent_below'   => 0.0,
    ];

    public static function normalizeShortHoursPolicy($value): array
    {
        if (is_string($value)) {
            $decoded = json_decode($value, true);
            $value = is_array($decoded) ? $decoded : null;
        }
        if (!is_array($value)) {
            return self::SHORT_HOURS_DEFAULTS;
        }

        $half = (float) ($value['half_day_below'] ?? self::SHORT_HOURS_DEFAULTS['half_day_below']);
        $half = max(0.0, min(24.0, $half));

        $absent = (float) ($value['absent_below'] ?? self::SHORT_HOURS_DEFAULTS['absent_below']);
        $absent = max(0.0, min(24.0, $absent));

        if ($absent > $half) {
            $absent = $half;
        }

        return [
            'enabled'        => filter_var($value['enabled'] ?? false, FILTER_VALIDATE_BOOLEAN),
            'half_day_below' => round($half, 2),
            'absent_below'   => round($absent, 2),
        ];
    }

    public function shortHoursPolicy(): array
    {
        return self::normalizeShortHoursPolicy($this->short_hours_policy);
    }

    public static function shortHoursCreditFor(array $policy, ?int $workedMinutes, float $baseCredit): float
    {
        $policy = self::normalizeShortHoursPolicy($policy);
        if (!$policy['enabled'] || $workedMinutes === null || $baseCredit < 1.0) {
            return $baseCredit;
        }

        $hours = $workedMinutes / 60;
        if ($policy['absent_below'] > 0 && $hours < $policy['absent_below']) {
            return 0.0;
        }
        if ($hours < $policy['half_day_below']) {
            return 0.5;
        }

        return $baseCredit;
    }

    public function lateMarkPolicy(): array
    {
        return self::normalizeLateMarkPolicy($this->late_mark_policy);
    }

    public static function lateMarkLopFor(array $policy, int $lateMarks): float
    {
        $policy = self::normalizeLateMarkPolicy($policy);
        if (!$policy['enabled'] || $lateMarks < $policy['count']) {
            return 0.0;
        }

        return intdiv(max(0, $lateMarks), $policy['count'])
            * self::LATE_MARK_DEDUCTIONS[$policy['deduction']];
    }

    public function lateMarkLopDays(int $lateMarks): float
    {
        return self::lateMarkLopFor($this->lateMarkPolicy(), $lateMarks);
    }

    public function getLogoUrlAttribute(): ?string
    {
        return file_url($this->logo);
    }

    public function getProfilePhotoUrlAttribute(): ?string
    {
        return file_url($this->profile_photo);
    }

    public function getSignatureUrlAttribute(): ?string
    {
        return file_url($this->signature_path);
    }

    public function client(): BelongsTo
    {
        return $this->belongsTo(Client::class);
    }

    public function createdBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function users(): HasMany
    {
        return $this->hasMany(User::class);
    }

    public function employees(): HasMany
    {
        return $this->hasMany(Employee::class);
    }

    public function departments(): HasMany
    {
        return $this->hasMany(Department::class);
    }

    public function permissions(): HasMany
    {
        return $this->hasMany(Permission::class);
    }

    public function approvalQueue(): HasMany
    {
        return $this->hasMany(ApprovalQueue::class);
    }

    public function activityLogs(): HasMany
    {
        return $this->hasMany(ActivityLog::class);
    }

    public function isActive(): bool
    {
        return $this->status === 'active';
    }
}
