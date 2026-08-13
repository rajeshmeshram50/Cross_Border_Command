<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A payroll cycle. See the create_payroll_periods migration for the rules it
 * encodes (attendance finalization gate + period lock).
 */
class PayrollPeriod extends Model
{
    use SoftDeletes;

    protected $fillable = [
        'client_id', 'branch_id',
        'month', 'year', 'label', 'period_start', 'period_end', 'working_days',
        'attendance_finalized', 'attendance_finalized_at', 'attendance_finalized_by',
        'status', 'locked_at', 'created_by',
    ];

    protected $casts = [
        'period_start'         => 'date',
        'period_end'           => 'date',
        'working_days'         => 'integer',
        'month'                => 'integer',
        'year'                 => 'integer',
        'attendance_finalized' => 'boolean',
        'attendance_finalized_at' => 'datetime',
        'locked_at'            => 'datetime',
    ];

    /**
     * Indian financial year the cycle belongs to — Apr..Mar, rendered
     * "2026-27". Derived (not stored) so it can never drift out of sync with
     * month/year, and so existing rows need no backfill. Jan/Feb/Mar belong to
     * the FY that STARTED the previous calendar year: Jan 2027 → "2026-27".
     */
    public static function financialYearFor(int $month, int $year): string
    {
        $startYear = $month >= 4 ? $year : $year - 1;
        return $startYear . '-' . substr((string) ($startYear + 1), -2);
    }

    /** Accessor: $period->financial_year */
    public function getFinancialYearAttribute(): string
    {
        return static::financialYearFor((int) $this->month, (int) $this->year);
    }

    public function runs(): HasMany
    {
        return $this->hasMany(PayrollRun::class);
    }

    public function payslips(): HasMany
    {
        return $this->hasMany(Payslip::class);
    }

    /** The current (non-superseded) run for this period, if any. */
    public function activeRun()
    {
        return $this->runs()->latest('id')->first();
    }
}
