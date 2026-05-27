<?php

namespace App\Models;

use App\Models\Masters\LicenseName;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;


class VendorDocument extends Model
{
    use SoftDeletes;

    protected $fillable = [
        'vendor_id', 'created_by',
        'kind', 'code',
        'document_name', 'license_type_id',
        'license_number', 'issuing_authority',
        'expiry', 'issue_date', 'expiry_date',
        'mandatory',
        'attachment_path',
    ];

    protected $casts = [
        'mandatory'   => 'boolean',
        'issue_date'  => 'date',
        'expiry_date' => 'date',
    ];

    public function vendor(): BelongsTo
    {
        return $this->belongsTo(Vendor::class);
    }

    public function licenseType(): BelongsTo
    {
        return $this->belongsTo(LicenseName::class, 'license_type_id');
    }
}
