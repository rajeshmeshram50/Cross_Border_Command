<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class LeadProduct extends Model
{
    public const SOURCING_STATUSES = ['required', 'not_required'];

    protected $fillable = [
        'client_id', 'lead_id', 'product_id',
        'currency', 'quantity', 'target_price', 'notes',
        'sourcing_status', 'procurement_done',
        'created_by',
    ];

    protected $casts = [
        'quantity'         => 'decimal:3',
        'target_price'     => 'decimal:2',
        'procurement_done' => 'boolean',
    ];

    public function setSourcingStatusAttribute($value): void
    {
        if ($value === null || $value === '') {
            $this->attributes['sourcing_status'] = null;
            return;
        }
        if (!in_array($value, self::SOURCING_STATUSES, true)) {
            throw new \InvalidArgumentException("Invalid sourcing_status: {$value}");
        }
        $this->attributes['sourcing_status'] = $value;
    }

    public function lead(): BelongsTo
    {
        return $this->belongsTo(Lead::class);
    }

    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class);
    }
}
