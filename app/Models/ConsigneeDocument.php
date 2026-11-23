<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ConsigneeDocument extends Model
{
    public const KIND_DD = 'dd';
    public const KIND_TL = 'tl';

    protected $fillable = [
        'consignee_id', 'kind',
        'name', 'license_number', 'issuing_authority',
        'issue_date', 'expiry_date',
        'attachment_path', 'description',
        'status', 'created_by',
    ];

    protected $casts = [
        'issue_date'  => 'date:Y-m-d',
        'expiry_date' => 'date:Y-m-d',
    ];

    protected $appends = ['attachment_url'];

    public function getAttachmentUrlAttribute(): ?string
    {
        return file_url($this->attachment_path);
    }

    public function consignee(): BelongsTo
    {
        return $this->belongsTo(Consignee::class);
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }
}
