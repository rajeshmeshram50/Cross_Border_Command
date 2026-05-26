<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * Sales Matrix → Proforma Invoice.
 *
 * Mirrors the Quotation model but with a `pi_type` discriminator
 * (with_shipment | without_shipment), BT reference fields, and a
 * source_quotation_id FK that links back to the quotation this PI
 * was converted from (nullable for standalone PIs).
 */
class ProformaInvoice extends Model
{
    use HasFactory;

    public const STATUS_DRAFT                  = 'draft';
    public const STATUS_SENT                   = 'sent';
    public const STATUS_APPROVED               = 'approved';
    public const STATUS_CONVERTED_TO_CONTRACT  = 'converted_to_contract';
    public const STATUS_CANCELLED              = 'cancelled';
    public const STATUSES = [
        self::STATUS_DRAFT,
        self::STATUS_SENT,
        self::STATUS_APPROVED,
        self::STATUS_CONVERTED_TO_CONTRACT,
        self::STATUS_CANCELLED,
    ];

    public const TYPE_WITH_SHIPMENT    = 'with_shipment';
    public const TYPE_WITHOUT_SHIPMENT = 'without_shipment';
    public const TYPES = [self::TYPE_WITH_SHIPMENT, self::TYPE_WITHOUT_SHIPMENT];

    public const SIGN_WITH    = 'with_signature';
    public const SIGN_WITHOUT = 'without_signature';
    public const SIGN_MODES   = [self::SIGN_WITH, self::SIGN_WITHOUT];

    public const DOC_INTERNATIONAL = 'International';
    public const DOC_DOMESTIC      = 'Domestic';
    public const DOC_TYPES         = [self::DOC_INTERNATIONAL, self::DOC_DOMESTIC];

    protected $fillable = [
        'client_id', 'branch_id',
        'code', 'version',
        'pi_type', 'bt_id', 'bt_date', 'signing_mode',
        'source_quotation_id', 'convert_from_code',
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
        'emailed_at', 'last_reminded_at', 'reminder_count',
        'terms',
        'created_by', 'updated_by',
    ];

    protected $casts = [
        'bt_date'          => 'date',
        'opportunity_date' => 'date',
        'exchange_rate'    => 'decimal:4',
        'sub_total'        => 'decimal:2',
        'shipping'         => 'decimal:2',
        'grand_total'      => 'decimal:2',
        'emailed_at'       => 'datetime',
        'last_reminded_at' => 'datetime',
        'reminder_count'   => 'integer',
    ];

    public function items(): HasMany
    {
        return $this->hasMany(ProformaInvoiceItem::class)->orderBy('line_no')->orderBy('id');
    }

    public function branch(): BelongsTo    { return $this->belongsTo(Branch::class); }
    public function customer(): BelongsTo  { return $this->belongsTo(Customer::class); }
    public function consignee(): BelongsTo { return $this->belongsTo(Consignee::class); }
    public function lead(): BelongsTo      { return $this->belongsTo(Lead::class, 'opp_id'); }
    public function sourceQuotation(): BelongsTo { return $this->belongsTo(Quotation::class, 'source_quotation_id'); }
    public function salesManager(): BelongsTo { return $this->belongsTo(User::class, 'sales_manager_id'); }
    public function creator(): BelongsTo   { return $this->belongsTo(User::class, 'created_by'); }

    public function scopeForClient(Builder $q, ?int $clientId): Builder
    {
        return $clientId ? $q->where('client_id', $clientId) : $q->whereRaw('1 = 0');
    }

    public function scopeActive(Builder $q): Builder
    {
        return $q->where('status', '!=', self::STATUS_CANCELLED);
    }
}
