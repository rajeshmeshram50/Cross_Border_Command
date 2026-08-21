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
        'pf_applicable', 'esi_applicable', 'pt_applicable', 'tds_applicable',
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
        'tds_applicable' => 'boolean',
        'approved_at'    => 'datetime',
        'version'        => 'integer',
    ];

    public function employee(): BelongsTo
    {
        return $this->belongsTo(Employee::class);
    }

    /**
     * Basic component amount — the base PF and gratuity are charged on.
     *
     * Resolved in three steps, because matching the CODE alone was silently
     * wrong for any structure not built by the seed:
     *
     *   1. code === 'basic'          — how the modal seeds it.
     *   2. label reads like "Basic"  — how it comes back after a human edits it.
     *   3. 50% of monthly gross      — last-resort assumption.
     *
     * Step 2 is the fix. Salary Setup lets HR delete an earning row and add
     * another, and addRow() codes new rows `comp_1`, `comp_2`, … — so a Basic
     * row that was removed and re-added is labelled "Basic Salary" but coded
     * `comp_3`, and step 1 misses it. The old code then fell straight to the
     * 50% assumption, which is not a rounding error: on a 2,000 basic inside a
     * 10,000 gross it returned 5,000, and PF came out 600 instead of 240 —
     * charged on two and a half times the real basic. That is exactly the
     * "PF is calculated on the whole salary instead of Basic Salary" report
     * (QA #84), still reachable after PF itself was moved back onto basic.
     */
    public function basicAmount(): float
    {
        [$amount] = $this->resolveBasic();
        return $amount;
    }

    /**
     * True when basicAmount() had to ASSUME the basic rather than read it —
     * no row identifiable as Basic, so 50% of gross was used.
     *
     * Exposed so payroll can say so on the payslip instead of deducting a
     * statutory head off a guess in silence.
     */
    public function basicIsAssumed(): bool
    {
        [, $source] = $this->resolveBasic();
        return $source === 'assumed';
    }

    /** @return array{0: float, 1: string} [amount, 'code'|'label'|'assumed'] */
    private function resolveBasic(): array
    {
        $rows = (array) $this->earnings;

        foreach ($rows as $c) {
            if (($c['code'] ?? null) === 'basic') {
                return [(float) ($c['amount'] ?? 0), 'code'];
            }
        }

        /* Whole-word "basic": "Basic", "Basic Salary" and "Basic + DA" match,
         * "Non-Basic Allowance" must not.
         *
         * \bbasic\b is not enough — a hyphen IS a word boundary, so "Non-Basic"
         * matched it and a row explicitly named as NOT basic would have been
         * used as the PF base. The lookbehind additionally refuses a preceding
         * word character or hyphen, which rules out "Non-Basic" and "NonBasic"
         * while leaving a leading "Basic…" untouched. First match wins, as in
         * the code pass above. */
        foreach ($rows as $c) {
            if (preg_match('/(?<![\w-])basic\b/i', (string) ($c['label'] ?? ''))) {
                return [(float) ($c['amount'] ?? 0), 'label'];
            }
        }

        return [round((float) $this->monthly_gross * 0.5, 2), 'assumed'];
    }
}
