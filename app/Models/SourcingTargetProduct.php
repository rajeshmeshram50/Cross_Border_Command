<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * A product line item under a SourcingTarget.
 *
 * Either a Product Master reference (product_id + snapshot fields) or a
 * Manual Entry (free-text name). Carries a target price, an optional
 * clarity note (text/link/pdf), and a completion flag that drives the
 * sourcing progress bar on the list page.
 */
class SourcingTargetProduct extends Model
{
    use SoftDeletes;

    protected $fillable = [
        'sourcing_target_id', 'created_by',
        'source', 'product_id',
        'product_code', 'product_name', 'segment', 'hsn_code',
        'target_price',
        'clarity_type', 'clarity_value', 'clarity_path',
        'is_completed',
    ];

    protected $casts = [
        'target_price' => 'decimal:2',
        'is_completed' => 'boolean',
    ];

    public function target(): BelongsTo
    {
        return $this->belongsTo(SourcingTarget::class, 'sourcing_target_id');
    }

    /** Set for Product Master rows; null for Manual Entry. */
    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class, 'product_id');
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }
}
