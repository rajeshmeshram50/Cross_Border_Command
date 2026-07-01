<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\MorphTo;

/**
 * Polymorphic uploaded-file record for a segment-rule's reference doc.
 *
 * One row = one file the user attached to a (Customer|Consignee|Vendor,
 * category, doc_code) tuple on Stage 2 of the onboarding wizard. The
 * tuple is unique — re-uploading replaces the previous row's path.
 *
 * `uploadable` is morphTo() so the same table backs all three entities.
 * The auto-appended `attachment_url` resolves the storage-driver URL so
 * the frontend can View/Download without knowing where the file lives.
 */
class SegmentDocUpload extends Model
{
    protected $fillable = [
        'uploadable_type', 'uploadable_id',
        'client_id',
        'category', 'doc_code', 'doc_name', 'requirement',
        'attachment_path', 'attachment_name', 'expiry_date',
        'uploaded_by',
    ];

    protected $casts = [
        'expiry_date' => 'date',
    ];

    /* Same pattern Client / Product / CustomerDocument use — keeps the
     * frontend free of any storage-layout knowledge. */
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
