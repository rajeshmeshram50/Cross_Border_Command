<?php

namespace App\Models\P2p;

use App\Models\Concerns\BelongsToTenant;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Append-only log of every quantity change on a PO line against its PI line.
 * The audit trail only — pending quantity is always computed from the live
 * lines, never summed from this table.
 */
class PoItemQtyHistory extends Model
{
    use BelongsToTenant;

    protected $table = 'p2p_po_item_qty_histories';

    public const UPDATED_AT = null;   // rows are never edited

    public const EVENTS = ['added', 'updated', 'removed', 'cancelled', 'deleted'];

    protected $fillable = [
        'client_id', 'branch_id', 'purchase_order_id', 'purchase_order_item_id', 'pi_item_id',
        'shipment_order_id', 'product_id', 'event',
        'pi_quantity', 'previous_qty', 'current_qty', 'change_qty', 'pending_after',
        'changed_by',
    ];

    protected $casts = [
        'pi_quantity'   => 'decimal:3',
        'previous_qty'  => 'decimal:3',
        'current_qty'   => 'decimal:3',
        'change_qty'    => 'decimal:3',
        'pending_after' => 'decimal:3',
        'created_at'    => 'datetime',
    ];

    public function purchaseOrder(): BelongsTo { return $this->belongsTo(PurchaseOrder::class, 'purchase_order_id'); }
    public function changedBy(): BelongsTo     { return $this->belongsTo(User::class, 'changed_by'); }
}
