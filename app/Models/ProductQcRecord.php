<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ProductQcRecord extends Model
{
    use HasFactory;

    protected $fillable = [
        'product_id',
        'qc_name',
        'qc_purpose',
        'issued_by',
        'qa_testing_parameter',
        'min_acceptance_criteria',
        'attachment_path',
    ];

    /** Mirrors the Product image accessors so the frontend can render
     *  the attachment without rebuilding the storage URL itself. */
    protected $appends = ['attachment_url'];

    public function getAttachmentUrlAttribute(): ?string
    {
        $p = $this->attachment_path;
        if (!$p || str_starts_with((string) $p, 'blob:')) {
            return null;
        }
        return file_url($p);
    }

    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class);
    }
}
