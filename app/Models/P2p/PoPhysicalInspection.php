<?php

namespace App\Models\P2p;

use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class PoPhysicalInspection extends Model
{
    protected $table = 'p2p_po_physical_inspections';

    public const VERDICTS = ['correct', 'damaged', 'mismatched'];

    protected $fillable = [
        'purchase_order_id', 'purchase_order_item_id', 'verdict', 'remark', 'proof_files',
        'inspected_by', 'inspected_at',
    ];

    protected $casts = [
        'proof_files'  => 'array',
        'inspected_at' => 'datetime',
    ];

    public function purchaseOrder(): BelongsTo { return $this->belongsTo(PurchaseOrder::class, 'purchase_order_id'); }
    public function item(): BelongsTo          { return $this->belongsTo(PurchaseOrderItem::class, 'purchase_order_item_id'); }
    public function inspector(): BelongsTo     { return $this->belongsTo(User::class, 'inspected_by'); }
}
