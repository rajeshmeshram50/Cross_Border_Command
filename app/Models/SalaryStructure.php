<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Versioned compensation definition for one employee. Only one row per
 * employee is `active`; revisions supersede rather than overwrite (Rule 19).
 */
class SalaryStructure extends Model
{
    use SoftDeletes;

    protected $fillable = [
        'client_id', 'branch_id', 'employee_id',
        'version', 'effective_from', 'status',
        'earnings', 'deductions',
        'monthly_gross', 'monthly_ctc',
        'pf_applicable', 'esi_applicable', 'pt_applicable',
        'approval_status', 'approved_by', 'approved_at', 'revision_note',
        'created_by',
    ];

    protected $casts = [
        'effective_from' => 'date',
        'earnings'       => 'array',
        'deductions'     => 'array',
        'monthly_gross'  => 'decimal:2',
        'monthly_ctc'    => 'decimal:2',
        'pf_applicable'  => 'boolean',
        'esi_applicable' => 'boolean',
        'pt_applicable'  => 'boolean',
        'approved_at'    => 'datetime',
        'version'        => 'integer',
    ];

    public function employee(): BelongsTo
    {
        return $this->belongsTo(Employee::class);
    }

    /** Basic component amount (PF/gratuity base). Falls back to 50% of gross. */
    public function basicAmount(): float
    {
        foreach ((array) $this->earnings as $c) {
            if (($c['code'] ?? null) === 'basic') {
                return (float) ($c['amount'] ?? 0);
            }
        }
        return round((float) $this->monthly_gross * 0.5, 2);
    }
}
