<?php

namespace App\Models\P2p;

use App\Models\Concerns\BelongsToTenant;
use App\Models\Vendor;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * Advance Receipt Refund Adjustment — raised when a PO with money released is cancelled.
 * Recovered / balance are stored and rebuilt from the recoveries on every change.
 */
class PoRefundAdjustment extends Model
{
    use BelongsToTenant, SoftDeletes;

    protected $table = 'p2p_po_refund_adjustments';

    public const STATUS_PENDING   = 'pending';
    public const STATUS_PARTIAL   = 'partial';
    public const STATUS_RECOVERED = 'recovered';

    public const REFUND_TYPES = ['Full Refund', 'Partial Refund'];
    public const RETAIN_REASONS = [
        'Cancellation Charges', 'Restocking Fee', 'Freight / Logistics Already Incurred', 'Bank & Remittance Charges',
        'Non-Recoverable GST', 'Customs / Duty Already Paid', 'Work Already Completed', 'Contractual Retention', 'Other',
    ];

    protected $fillable = [
        'client_id', 'branch_id', 'code', 'purchase_order_id', 'vendor_id',
        'refund_date', 'supplier_ref_no', 'attachment_path', 'attachment_name', 'refund_type', 'reason',
        'paid_amount', 'refund_amount', 'retained_amount', 'retained_type', 'retained_remark',
        'recovered_amount', 'balance_amount', 'status',
        'zoho_vendorcredit_id', 'zoho_vendorcredit_number', 'zoho_applied_amount', 'zoho_sync_status', 'zoho_synced_at', 'zoho_error',
        'created_by', 'updated_by',
    ];

    protected $casts = [
        'refund_date'         => 'date',
        'paid_amount'         => 'decimal:2',
        'refund_amount'       => 'decimal:2',
        'retained_amount'     => 'decimal:2',
        'recovered_amount'    => 'decimal:2',
        'balance_amount'      => 'decimal:2',
        'zoho_applied_amount' => 'decimal:2',
        'zoho_synced_at'      => 'datetime',
    ];

    public function purchaseOrder(): BelongsTo { return $this->belongsTo(PurchaseOrder::class, 'purchase_order_id'); }
    public function vendor(): BelongsTo        { return $this->belongsTo(Vendor::class)->withTrashed(); }
    public function recoveries(): HasMany      { return $this->hasMany(PoRefundRecovery::class, 'refund_adjustment_id')->orderBy('recovered_date')->orderBy('id'); }
}
