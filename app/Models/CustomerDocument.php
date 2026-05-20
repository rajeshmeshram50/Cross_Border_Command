<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Customer KYC document (Company Due Diligence + Trade Licence).
 *
 * `kind` distinguishes which sub-tab the row belongs to:
 *   'dd' → Company Due Diligence
 *   'tl' → Trade Licence
 *
 * Owner KYC uses {@see CustomerOwner} instead because the shape differs
 * (no license number, three separate identity-proof file slots).
 */
class CustomerDocument extends Model
{
    public const KIND_DD = 'dd';
    public const KIND_TL = 'tl';

    protected $fillable = [
        'customer_id', 'kind',
        'name', 'license_number', 'issuing_authority',
        'issue_date', 'expiry_date',
        'attachment_path', 'description',
        'status', 'created_by',
    ];

    protected $casts = [
        'issue_date'  => 'date:Y-m-d',
        'expiry_date' => 'date:Y-m-d',
    ];

    /**
     * Auto-append the resolved URL alongside the raw path so the frontend
     * can render the View link without knowing the storage layout. Same
     * pattern Client (logo_url) and Product (primary_image_url) use, so
     * the file shows up in EVERY response shape — list, single, nested
     * via Customer's documents relation — without per-controller code.
     */
    protected $appends = ['attachment_url'];

    public function getAttachmentUrlAttribute(): ?string
    {
        return file_url($this->attachment_path);
    }

    public function customer(): BelongsTo
    {
        return $this->belongsTo(Customer::class);
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }
}
