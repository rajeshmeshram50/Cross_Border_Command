<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\MorphTo;

class SegmentDocUpload extends Model
{
    protected $fillable = [
        'uploadable_type', 'uploadable_id',
        'client_id',
        'category', 'doc_code', 'doc_name', 'requirement',
        'attachment_path', 'attachment_name', 'issue_date', 'expiry_date',
        'uploaded_by',
    ];

    protected $casts = [
        'issue_date'  => 'date',
        'expiry_date' => 'date',
    ];

    protected $appends = ['attachment_url'];

    public function getAttachmentUrlAttribute(): ?string
    {
        return file_url($this->attachment_path);
    }

    public function uploadable(): MorphTo
    {
        return $this->morphTo();
    }

    public function uploader(): BelongsTo
    {
        return $this->belongsTo(User::class, 'uploaded_by');
    }
}
