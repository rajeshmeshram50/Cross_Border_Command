<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;


class VendorOwner extends Model
{
    use SoftDeletes;

    protected $fillable = [
        'vendor_id', 'created_by',
        'code',
        'document_name', 'issuing_authority', 'document_number',
        'issue_date', 'expiry', 'status',
        'attachment_path',
    ];

    protected $casts = [
        'issue_date' => 'date',
    ];

    public function vendor(): BelongsTo
    {
        return $this->belongsTo(Vendor::class);
    }
}
