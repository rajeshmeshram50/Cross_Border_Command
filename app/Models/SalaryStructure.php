<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

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

    public static function versionsInForce(int $employeeId, \Carbon\Carbon $winStart, \Carbon\Carbon $winEnd): array
    {
        $rows = static::where('employee_id', $employeeId)
            ->whereIn('status', ['active', 'superseded'])
            ->whereDate('effective_from', '<=', $winEnd)
            ->orderBy('effective_from')
            ->orderBy('version')
            ->orderByRaw("CASE WHEN status = 'active' THEN 1 ELSE 0 END")
            ->orderBy('id')
            ->get(['id', 'version', 'effective_from']);

        if ($rows->isEmpty()) {
            return ['version' => null, 'from' => null, 'all' => []];
        }

        $opener = $rows->last(fn ($r) => \Carbon\Carbon::parse($r->effective_from)->lte($winStart));
        $inside = $rows->filter(fn ($r) => \Carbon\Carbon::parse($r->effective_from)->gt($winStart));
        $used   = collect([$opener])->filter()->concat($inside)->unique('id')->values();
        $primary = $used->last() ?: $rows->last();

        return [
            'version' => (int) $primary->version,
            'from'    => \Carbon\Carbon::parse($primary->effective_from)->toDateString(),
            'all'     => $used->pluck('version')->map(fn ($v) => (int) $v)->values()->all(),
        ];
    }

    public function basicAmount(): float
    {
        [$amount] = $this->resolveBasic();
        return $amount;
    }

    public function basicIsAssumed(): bool
    {
        [, $source] = $this->resolveBasic();
        return $source === 'assumed';
    }

    public function hraAmount(): ?float
    {
        $rows = (array) $this->earnings;

        foreach ($rows as $c) {
            if (($c['code'] ?? null) === 'hra') {
                return (float) ($c['amount'] ?? 0);
            }
        }
        foreach ($rows as $c) {
            $label = (string) ($c['label'] ?? '');
            if (preg_match('/(?<![\w-])(hra|house\s*rent)\b/i', $label)) {
                return (float) ($c['amount'] ?? 0);
            }
        }
        return null;
    }

    private function resolveBasic(): array
    {
        $rows = (array) $this->earnings;

        foreach ($rows as $c) {
            if (($c['code'] ?? null) === 'basic') {
                return [(float) ($c['amount'] ?? 0), 'code'];
            }
        }

        foreach ($rows as $c) {
            if (preg_match('/(?<![\w-])basic\b/i', (string) ($c['label'] ?? ''))) {
                return [(float) ($c['amount'] ?? 0), 'label'];
            }
        }

        return [round((float) $this->monthly_gross * 0.5, 2), 'assumed'];
    }
}
