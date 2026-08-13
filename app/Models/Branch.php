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
        // Sandwich Leave Policy master switch. Branch-level on purpose: it
        // governs every employee posted here, including future joiners.
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
        // Late-mark deduction rule for this office (see lateMarkPolicy()).
        'late_mark_policy',
        // Loss-of-pay rule for this office (see lopPolicy()).
        'lop_policy',
        // Short-hours → half day / absent rule (see shortHoursPolicy()).
        'short_hours_policy',
        'bank_accounts',
        'created_by',
    ];

    protected $appends = ['logo_url', 'profile_photo_url', 'signature_url'];

    protected function casts(): array
    {
        return [
            'max_users' => 'integer',
            // Cast so the API always emits a real JSON true/false. Without it
            // Postgres hands back "t"/"f" and the form's Yes/No select would
            // silently fall through to "not chosen" on edit.
            'sandwich_policy' => 'boolean',
            'established_at' => 'date',
            'shifts' => 'array',
            'late_mark_policy' => 'array',
            'lop_policy' => 'array',
            'short_hours_policy' => 'array',
            'bank_accounts' => 'array',
        ];
    }

    /* ── Late-mark policy ────────────────────────────────────────────────
     *
     * How many late marks cost how much pay, per branch. Shape:
     *   ['enabled' => bool, 'count' => int, 'deduction' => 'half_day'|'full_day']
     *
     * Only half day and full day are offered on purpose — payroll rounds to
     * 0.5-day steps, so anything finer would not survive the paid-days math.
     *
     * A branch that was never configured (NULL column) keeps the legacy
     * hardcoded rule — 3 late marks → half a day — so nothing changes for
     * existing payroll runs until an admin edits the branch.
     */
    public const LATE_MARK_DEFAULTS = [
        'enabled'   => true,
        'count'     => 3,
        'deduction' => 'half_day',
    ];

    /** Days of LOP charged per completed block, keyed by deduction option. */
    public const LATE_MARK_DEDUCTIONS = [
        'half_day' => 0.5,
        'full_day' => 1.0,
    ];

    /**
     * Normalise any stored / submitted policy value into the canonical shape.
     * Accepts a JSON string (multipart transport), an array, or null.
     */
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
        /* A zero or negative block size cannot be charged — it would divide the
         * month into infinite deductions. It used to be clamped up to 1, which
         * quietly turned the least plausible setting into the HARSHEST one:
         * a branch saved with count 0 charged on every single late mark. Nobody
         * types 0 meaning "deduct constantly"; they mean "don't deduct". So an
         * unusable count now switches the rule OFF instead, which is both the
         * safer failure and the obvious reading. The upper clamp stays. */
        $countUnusable = $count < 1;
        $count = max(1, min(31, $count));

        $deduction = (string) ($value['deduction'] ?? self::LATE_MARK_DEFAULTS['deduction']);
        if (!array_key_exists($deduction, self::LATE_MARK_DEDUCTIONS)) {
            $deduction = self::LATE_MARK_DEFAULTS['deduction'];
        }

        return [
            'enabled'   => !$countUnusable
                && filter_var($value['enabled'] ?? true, FILTER_VALIDATE_BOOLEAN),
            'count'     => $count,
            'deduction' => $deduction,
        ];
    }

    /* ── Loss-of-pay policy ──────────────────────────────────────────────
     *
     * What one absent day actually costs, per branch. Shape:
     *   ['basis' => 'basic'|'gross', 'divisor' => 'calendar'|'working']
     *
     *   per-day = (basis amount) ÷ (divisor day count)
     *
     * The two axes are independent and both matter. On a ₹1,00,416.67 gross /
     * ₹50,208.34 basic salary in a 31-day month with 26 working days, the four
     * combinations charge very different amounts for the same absence:
     *
     *   basic  ÷ calendar  = ₹1,619.62   ← legacy default, unchanged
     *   basic  ÷ working   = ₹1,931.09
     *   gross  ÷ calendar  = ₹3,239.25
     *   gross  ÷ working   = ₹3,862.18   ← what a worked day actually earns
     *
     * Charging on BASIC means allowances are never clawed back, so an employee
     * absent the whole month still takes home the entire allowance half of
     * their salary. That is a legitimate policy — plenty of employers run it —
     * but it has to be a decision somebody made, not an accident of the code.
     * Hence this switch, defaulted to the legacy behaviour so no existing
     * payslip moves until an admin changes it.
     */
    public const LOP_DEFAULTS = [
        'basis'   => 'basic',
        'divisor' => 'calendar',
    ];

    public const LOP_BASES    = ['basic', 'gross'];
    public const LOP_DIVISORS = ['calendar', 'working'];

    /**
     * Normalise any stored / submitted policy value into the canonical shape.
     * Accepts a JSON string (multipart transport), an array, or null.
     */
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

    /** This branch's effective loss-of-pay policy, defaults applied. */
    public function lopPolicy(): array
    {
        return self::normalizeLopPolicy($this->lop_policy);
    }

    /**
     * The per-day loss-of-pay rate a policy charges.
     *
     * Static and policy-first for the same reason as lateMarkLopFor(): payroll
     * must be able to price an absence for an employee with no branch at all
     * without a second copy of this arithmetic drifting out of step.
     */
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

    /* ── Short-hours policy ──────────────────────────────────────────────
     *
     * How few hours a WORKED day must fall under before it stops counting as a
     * full day. Shape:
     *   ['enabled' => bool, 'half_day_below' => float, 'absent_below' => float]
     *
     * Both thresholds are in hours, measured on the time actually worked:
     *
     *   worked < absent_below     → 0    (day not credited at all)
     *   worked < half_day_below   → 0.5  (half day)
     *   otherwise                 → full credit, as today
     *
     * `absent_below = 0` disables the absent tier, which is the default — the
     * gentler half-day tier alone is what most offices want, and jumping
     * straight to a full day's LOP for a short attendance is the kind of rule
     * that should have to be typed in deliberately.
     *
     * DISABLED by default. Until an admin switches it on, a day's credit comes
     * purely from attendances.status exactly as it always has, so no existing
     * payslip moves. This exists because payroll previously had no concept of
     * short hours at all: a two-hour day stored as 'Present' was paid in full,
     * and nothing in the production punch flow ever writes 'Half Day' — only a
     * manual status edit could produce one.
     */
    public const SHORT_HOURS_DEFAULTS = [
        'enabled'        => false,
        'half_day_below' => 4.0,
        'absent_below'   => 0.0,
    ];

    /**
     * Normalise any stored / submitted policy value into the canonical shape.
     * Accepts a JSON string (multipart transport), an array, or null.
     */
    public static function normalizeShortHoursPolicy($value): array
    {
        if (is_string($value)) {
            $decoded = json_decode($value, true);
            $value = is_array($decoded) ? $decoded : null;
        }
        if (!is_array($value)) {
            return self::SHORT_HOURS_DEFAULTS;
        }

        // Clamp to a sane 0..24 h. A threshold at or above 24 would demote
        // every single day; a negative one would never fire.
        $half = (float) ($value['half_day_below'] ?? self::SHORT_HOURS_DEFAULTS['half_day_below']);
        $half = max(0.0, min(24.0, $half));

        $absent = (float) ($value['absent_below'] ?? self::SHORT_HOURS_DEFAULTS['absent_below']);
        $absent = max(0.0, min(24.0, $absent));

        // An absent threshold above the half-day one would swallow the half-day
        // tier entirely and read as a config typo. Cap it at the half-day mark
        // so the two tiers always stack in the order they are described.
        if ($absent > $half) {
            $absent = $half;
        }

        return [
            'enabled'        => filter_var($value['enabled'] ?? false, FILTER_VALIDATE_BOOLEAN),
            'half_day_below' => round($half, 2),
            'absent_below'   => round($absent, 2),
        ];
    }

    /** This branch's effective short-hours policy, defaults applied. */
    public function shortHoursPolicy(): array
    {
        return self::normalizeShortHoursPolicy($this->short_hours_policy);
    }

    /**
     * The day credit a policy allows for a worked day, given the minutes
     * actually worked and the credit the day would otherwise earn.
     *
     * Returns $baseCredit untouched when the policy is off, when the day was
     * not a full-credit day to begin with (an explicit Half Day is already
     * 0.5 and must not be halved again), or when $workedMinutes is null —
     * which means the hours could not be measured, typically a day missing one
     * side of its punch pair. Guessing on unmeasurable data would silently dock
     * pay for what is really a data-quality problem; those days already raise a
     * missing-punch warning of their own.
     */
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

    /** This branch's effective policy, defaults applied. */
    public function lateMarkPolicy(): array
    {
        return self::normalizeLateMarkPolicy($this->late_mark_policy);
    }

    /**
     * Days of loss-of-pay a policy charges for a given number of late marks.
     * Deducts once per COMPLETED block: with count=3 / half_day, 2 lates cost
     * nothing, 3 cost 0.5, 6 cost 1.0.
     *
     * Static and policy-first so payroll can call it for an employee with no
     * branch at all (falls back to the defaults) without a second copy of the
     * arithmetic drifting out of step with this one.
     */
    public static function lateMarkLopFor(array $policy, int $lateMarks): float
    {
        $policy = self::normalizeLateMarkPolicy($policy);
        if (!$policy['enabled'] || $lateMarks < $policy['count']) {
            return 0.0;
        }

        return intdiv(max(0, $lateMarks), $policy['count'])
            * self::LATE_MARK_DEDUCTIONS[$policy['deduction']];
    }

    /** This branch's LOP days for a given number of late marks. */
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

    /** Authorised-signatory image rendered on "with signature" Quotation/PI PDFs. */
    public function getSignatureUrlAttribute(): ?string
    {
        return file_url($this->signature_path);
    }

    // ── Relationships ──

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

    // ── Helpers ──

    public function isActive(): bool
    {
        return $this->status === 'active';
    }
}
