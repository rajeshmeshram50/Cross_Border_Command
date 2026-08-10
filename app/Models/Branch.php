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
        // A zero/negative block size would divide the month into infinite
        // deductions; clamp to a sane 1..31 (one month of working days).
        $count = max(1, min(31, $count));

        $deduction = (string) ($value['deduction'] ?? self::LATE_MARK_DEFAULTS['deduction']);
        if (!array_key_exists($deduction, self::LATE_MARK_DEDUCTIONS)) {
            $deduction = self::LATE_MARK_DEFAULTS['deduction'];
        }

        return [
            'enabled'   => filter_var($value['enabled'] ?? true, FILTER_VALIDATE_BOOLEAN),
            'count'     => $count,
            'deduction' => $deduction,
        ];
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
