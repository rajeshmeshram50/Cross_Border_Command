<?php

namespace App\Models\P2p;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * Which SPI item, and how much of it, sits in a box.
 *
 * This table IS the packing tracker: packed quantity is SUM(quantity) here, and
 * pending is the item's qty_spi minus that sum. Nothing is stored on the item.
 * Every such sum must exclude soft-deleted rows, or a removed box still counts
 * as packed.
 *
 * Advanced Details and the product remark live here rather than on the box,
 * because one carton can hold two products from two batches.
 */
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
        // Master flag ids. A json column rather than a junction table while the
        // flag master is not built; the ids already point at it.
        'flags'        => 'array',
        'expiry_date'  => 'date',
        'mfg_date'     => 'date',
    ];

    public function box(): BelongsTo         { return $this->belongsTo(SpiBox::class, 'box_id'); }
    public function invoiceItem(): BelongsTo { return $this->belongsTo(SupplierInvoiceItem::class, 'supplier_invoice_item_id'); }
    /** Photos of THIS product inside the box, as opposed to the carton itself. */
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
