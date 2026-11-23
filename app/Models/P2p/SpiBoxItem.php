<?php

namespace App\Models\P2p;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class SpiBoxItem extends Model
{
    use SoftDeletes;

    protected $table = 'p2p_spi_box_items';

    public const REMARK_CORRECT    = 'correct';
    public const REMARK_DAMAGED    = 'damaged';
    public const REMARK_MISMATCHED = 'mismatched';
    public const REMARK_EXTRA      = 'extra';

    public const REMARKS = ['correct', 'damaged', 'mismatched', 'extra'];

    protected $fillable = [
        'box_id', 'supplier_invoice_item_id', 'quantity', 'is_stackable',
        'remark', 'remark_note', 'flags',
        'serial_no', 'lot_no', 'batch_no', 'cat_no', 'expiry_date', 'mfg_date',
    ];

    protected $casts = [
        'quantity'     => 'decimal:3',
        'is_stackable' => 'boolean',
        'flags'        => 'array',
        'expiry_date'  => 'date',
        'mfg_date'     => 'date',
    ];

    public function box(): BelongsTo         { return $this->belongsTo(SpiBox::class, 'box_id'); }
    public function invoiceItem(): BelongsTo { return $this->belongsTo(SupplierInvoiceItem::class, 'supplier_invoice_item_id'); }
    public function attachments(): HasMany   { return $this->hasMany(SpiBoxAttachment::class, 'box_item_id'); }

    public function isDamaged(): bool
    {
        return $this->remark !== self::REMARK_CORRECT;
    }

    public function isExpired(): bool
    {
        return $this->expiry_date?->isPast() ?? false;
    }

    public function hasFlag(int $flagId): bool
    {
        return in_array($flagId, $this->flags ?? [], true);
    }
}
