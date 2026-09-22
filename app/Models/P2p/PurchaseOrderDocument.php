<?php

namespace App\Models\P2p;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

/** Stage 04 · a document generated for the PO and tracked to signature. */
class PurchaseOrderDocument extends Model
{
    use BelongsToTenant, SoftDeletes;

    protected $table = 'p2p_purchase_order_documents';

    public const STATUS_PENDING = 'pending';
    public const STATUS_SENT    = 'sent';
    public const STATUS_SIGNED  = 'signed';
    public const STATUSES       = [self::STATUS_PENDING, self::STATUS_SENT, self::STATUS_SIGNED];
    public const KINDS          = ['purchase_order', 'agreement', 'other'];
    /** Which CLM library the row came from; null for the Purchase Order itself. */
    public const SOURCES        = ['trade', 'agreement'];

    /** Mandatory by the library, or marked necessary on this PO. */
    public function isNeeded(): bool
    {
        return $this->is_required === 'yes' || $this->needed === 'yes';
    }

    protected $fillable = [
        'client_id', 'branch_id', 'purchase_order_id', 'code', 'name', 'doc_sub', 'doc_kind',
        'source_type', 'source_id', 'is_required', 'needed', 'needed_by', 'needed_at',
        'generated_on', 'valid_up_to', 'file_path', 'original_name', 'mime_type', 'size_bytes',
        'status', 'sent_at', 'signed_at', 'signature_request_id', 'created_by', 'updated_by',
    ];

    protected $casts = [
        'generated_on' => 'date',
        'valid_up_to'  => 'date',
        'needed_at'    => 'datetime',
        'sent_at'      => 'datetime',
        'signed_at'    => 'datetime',
        'size_bytes'   => 'integer',
    ];

    public function purchaseOrder(): BelongsTo { return $this->belongsTo(PurchaseOrder::class, 'purchase_order_id'); }
}
