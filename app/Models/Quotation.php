<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * Sales Matrix → Quotations.
 *
 * Header for outgoing quotations. Status lifecycle:
 *   draft → sent → approved → converted_to_pi
 *                          → cancelled (terminal — soft delete)
 *
 * Totals are recomputed from `items` whenever the controller writes;
 * see Quotation::recomputeTotals() for the single source of truth.
 */
class Quotation extends Model
{
    use HasFactory;

    public const STATUS_DRAFT            = 'draft';
    public const STATUS_SENT             = 'sent';
    public const STATUS_APPROVED         = 'approved';
    public const STATUS_CONVERTED_TO_PI  = 'converted_to_pi';
    public const STATUS_CANCELLED        = 'cancelled';

    public const STATUSES = [
        self::STATUS_DRAFT,
        self::STATUS_SENT,
        self::STATUS_APPROVED,
        self::STATUS_CONVERTED_TO_PI,
        self::STATUS_CANCELLED,
    ];

    public const DOC_INTERNATIONAL = 'International';
    public const DOC_DOMESTIC      = 'Domestic';
    public const DOC_TYPES         = [self::DOC_INTERNATIONAL, self::DOC_DOMESTIC];

    protected $fillable = [
        'client_id', 'branch_id',
        'code', 'version',
        'doc_type',
        'opp_id', 'opp_code', 'opportunity_date',
        'customer_id', 'customer_name',
        'consignee_id', 'consignee_name',
        'bank_account_id', 'bank_label',
        'currency', 'exchange_rate',
        'inco_term', 'port_of_loading', 'port_of_discharge', 'final_destination', 'origin_country',
        'state_code',
        'sales_manager_id', 'sales_manager_name',
        'sub_total', 'shipping', 'grand_total',
        'status',
        'terms',
        'created_by', 'updated_by',
    ];

    protected $casts = [
        'opportunity_date' => 'date',
        'exchange_rate'    => 'decimal:4',
        'sub_total'        => 'decimal:2',
        'shipping'         => 'decimal:2',
        'grand_total'      => 'decimal:2',
    ];

    /* ── Relations ──────────────────────────────────────────── */

    public function items(): HasMany
    {
        return $this->hasMany(QuotationItem::class)->orderBy('line_no')->orderBy('id');
    }

    public function customer(): BelongsTo  { return $this->belongsTo(Customer::class); }
    public function consignee(): BelongsTo { return $this->belongsTo(Consignee::class); }
    public function lead(): BelongsTo      { return $this->belongsTo(Lead::class, 'opp_id'); }
    public function salesManager(): BelongsTo { return $this->belongsTo(User::class, 'sales_manager_id'); }
    public function creator(): BelongsTo   { return $this->belongsTo(User::class, 'created_by'); }

    /* ── Scopes ─────────────────────────────────────────────── */

    public function scopeForClient(Builder $q, ?int $clientId): Builder
    {
        return $clientId ? $q->where('client_id', $clientId) : $q->whereRaw('1 = 0');
    }

    public function scopeActive(Builder $q): Builder
    {
        return $q->where('status', '!=', self::STATUS_CANCELLED);
    }

    /* ── Helpers ────────────────────────────────────────────── */

    /**
     * Recompute sub_total / grand_total from the line items. Call after
     * any write that touches items. Doesn't save — returns the new
     * values so the caller can decide when to persist them.
     *
     * @return array{sub_total: float, grand_total: float}
     */
    public function recomputeTotals(): array
    {
        $sub = 0.0;
        foreach ($this->items as $it) {
            $sub += (float) $it->amount;
        }
        $grand = $sub + (float) ($this->shipping ?? 0);
        return ['sub_total' => round($sub, 2), 'grand_total' => round($grand, 2)];
    }
}
