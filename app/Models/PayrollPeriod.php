<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Database\Eloquent\Relations\HasMany;

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

    public static function financialYearFor(int $month, int $year): string
    {
        $startYear = $month >= 4 ? $year : $year - 1;
        return $startYear . '-' . substr((string) ($startYear + 1), -2);
    }

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

    public function activeRun()
    {
        return $this->runs()->latest('id')->first();
    }
}
