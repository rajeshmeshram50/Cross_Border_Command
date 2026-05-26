<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Lead ↔ Product mapping row. One per (lead, product). See the
 * migration for column intent. Mutated by the matrix-detail toolbar's
 * Product Directory + Add Product flows.
 */
class LeadProduct extends Model
{
    /** Allowed sourcing_status values — matches the column's enum
     *  definition in the migration. NULL is also allowed for rows
     *  predating the sourcing flow. Guard at the model so a direct
     *  write of an invalid value (e.g., via console seeder) raises
     *  instead of silently corrupting the Stage 3 tabs. */
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

    /** B19: enum guard at the mutator layer so a bypass of the
     *  controller validator (e.g., direct mass-assignment from a
     *  console seed or test) can't write a bogus value. NULL stays
     *  allowed — the column is nullable for legacy rows that pre-date
     *  the sourcing flow. */
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
