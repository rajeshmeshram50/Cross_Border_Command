<?php

namespace App\Models\P2p;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

/** Money received back from the supplier against a refund adjustment (a Zoho vendor-credit refund). */
class PoRefundRecovery extends Model
{
    use BelongsToTenant, SoftDeletes;

    protected $table = 'p2p_po_refund_recoveries';

    protected $fillable = [
        'client_id', 'branch_id', 'refund_adjustment_id', 'purchase_order_id',
        'amount', 'recovered_date', 'reference_no', 'proof_path', 'proof_name',
        'zoho_refund_id', 'zoho_sync_status', 'zoho_synced_at', 'zoho_error',
        'created_by', 'updated_by',
    ];

    protected $casts = [
        'amount'         => 'decimal:2',
        'recovered_date' => 'date',
        'zoho_synced_at' => 'datetime',
    ];

    public function adjustment(): BelongsTo    { return $this->belongsTo(PoRefundAdjustment::class, 'refund_adjustment_id'); }
    public function purchaseOrder(): BelongsTo { return $this->belongsTo(PurchaseOrder::class, 'purchase_order_id'); }
}
