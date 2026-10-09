<?php

namespace App\Models\P2p;

use App\Models\Branch;
use App\Models\Client;
use App\Models\Concerns\BelongsToTenant;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * Stage 03 · one physical carton on an SPI.
 *
 * Only what belongs to the CARTON lives here. Anything that varies per product
 * inside it — remark, batch, expiry, flags — is on SpiBoxItem, because one box
 * can hold two products from two batches.
 *
 * Tenant-scoped (unlike the line tables) because a box is scanned by code on
 * the warehouse floor, independently of its invoice.
 */
class SpiBox extends Model
{
    use BelongsToTenant, SoftDeletes;

    protected $table = 'p2p_spi_boxes';

    /** s1 one product -> one box · s2 one product -> many boxes · s3 many products -> one box */
    public const SCENARIOS  = ['s1', 's2', 's3'];
    public const CONDITIONS = ['perfect', 'minor', 'major', 'severe'];

    /** Divisor for volumetric weight in centimetres, the air-freight standard. */
    public const VOLUMETRIC_DIVISOR = 5000;

    protected $fillable = [
        'client_id', 'branch_id', 'supplier_invoice_id',
        'scenario', 'box_code',
        'length_cm', 'width_cm', 'height_cm',
        'weight_kg', 'net_weight_kg', 'gross_weight_kg',
        'condition', 'sticker_printed_at', 'created_by',
    ];

    protected $casts = [
        'length_cm'          => 'decimal:2',
        'width_cm'           => 'decimal:2',
        'height_cm'          => 'decimal:2',
        'weight_kg'          => 'decimal:3',
        'net_weight_kg'      => 'decimal:3',
        'gross_weight_kg'    => 'decimal:3',
        'sticker_printed_at' => 'datetime',
    ];

    public function client(): BelongsTo    { return $this->belongsTo(Client::class); }
    public function branch(): BelongsTo    { return $this->belongsTo(Branch::class); }
    public function invoice(): BelongsTo   { return $this->belongsTo(SupplierInvoice::class, 'supplier_invoice_id'); }
    public function createdBy(): BelongsTo { return $this->belongsTo(User::class, 'created_by'); }

    public function items(): HasMany       { return $this->hasMany(SpiBoxItem::class, 'box_id'); }
    public function attachments(): HasMany { return $this->hasMany(SpiBoxAttachment::class, 'box_id'); }
    /** A box rests in one place at a time, hence the unique on box_id. */
    public function putaway(): HasOne      { return $this->hasOne(SpiPutaway::class, 'box_id'); }

    /**
     * Once the label is on the carton the code is fixed: it is being scanned at
     * put-away, so renumbering it would point the floor at the wrong box.
     */
    public function isCodeLocked(): bool
    {
        return $this->sticker_printed_at !== null;
    }

    public function isDamaged(): bool
    {
        return $this->condition !== 'perfect';
    }

    /** Computed, never stored — dimensions change and a stale copy would lie. */
    public function volumetricWeightKg(): ?float
    {
        if (!$this->length_cm || !$this->width_cm || !$this->height_cm) return null;

        return round(
            ((float) $this->length_cm * (float) $this->width_cm * (float) $this->height_cm) / self::VOLUMETRIC_DIVISOR,
            3
        );
    }
}
