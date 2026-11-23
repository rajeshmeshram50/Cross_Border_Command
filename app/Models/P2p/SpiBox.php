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

class SpiBox extends Model
{
    use BelongsToTenant, SoftDeletes;

    protected $table = 'p2p_spi_boxes';

    public const SCENARIOS  = ['s1', 's2', 's3'];
    public const CONDITIONS = ['perfect', 'minor', 'major', 'severe'];

    public const VOLUMETRIC_DIVISOR = 6000;

    protected $fillable = [
        'flags',
        'client_id', 'branch_id', 'supplier_invoice_id',
        'scenario', 'box_code',
        'length_cm', 'width_cm', 'height_cm',
        'weight_kg', 'net_weight_kg', 'gross_weight_kg',
        'condition', 'is_stackable',
        'temp_min_c', 'temp_max_c',
        'sticker_printed_at', 'created_by',
    ];

    protected $casts = [
        'flags' => 'array',
        'is_stackable'       => 'integer',
        'temp_min_c'         => 'decimal:2',
        'temp_max_c'         => 'decimal:2',
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
    public function putaway(): HasOne      { return $this->hasOne(SpiPutaway::class, 'box_id'); }

    public function isCodeLocked(): bool
    {
        return $this->sticker_printed_at !== null;
    }

    public function isDamaged(): bool
    {
        return $this->condition !== 'perfect';
    }

    public function volumetricWeightKg(): ?float
    {
        if (!$this->length_cm || !$this->width_cm || !$this->height_cm) return null;

        return round(
            ((float) $this->length_cm * (float) $this->width_cm * (float) $this->height_cm) / self::VOLUMETRIC_DIVISOR,
            3
        );
    }
}
