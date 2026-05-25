<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class LeadProductSharedPrice extends Model
{
    protected $fillable = [
        'client_id', 'lead_id', 'lead_product_id',
        'quoted_price', 'shared_at', 'created_by',
    ];

    protected $casts = [
        'quoted_price' => 'decimal:2',
        'shared_at'    => 'datetime',
    ];

    public function lead(): BelongsTo
    {
        return $this->belongsTo(Lead::class);
    }

    public function leadProduct(): BelongsTo
    {
        return $this->belongsTo(LeadProduct::class);
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }
}
