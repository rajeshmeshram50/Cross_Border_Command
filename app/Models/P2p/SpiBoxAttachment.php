<?php

namespace App\Models\P2p;

use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

class SpiBoxAttachment extends Model
{
    use SoftDeletes;

    protected $table = 'p2p_spi_box_attachments';

    public const UPDATED_AT = null;

    protected $fillable = [
        'box_id', 'box_item_id', 'file_path', 'file_name', 'uploaded_by',
    ];

    protected $appends = ['url', 'is_image'];

    public function box(): BelongsTo        { return $this->belongsTo(SpiBox::class, 'box_id'); }
    public function boxItem(): BelongsTo    { return $this->belongsTo(SpiBoxItem::class, 'box_item_id'); }
    public function uploadedBy(): BelongsTo { return $this->belongsTo(User::class, 'uploaded_by'); }

    public function isForProduct(): bool
    {
        return $this->box_item_id !== null;
    }

    public function getUrlAttribute(): ?string
    {
        return file_url($this->file_path);
    }

    public function getIsImageAttribute(): bool
    {
        return $this->isImage();
    }

    public function isImage(): bool
    {
        return in_array(
            strtolower(pathinfo((string) $this->file_name, PATHINFO_EXTENSION)),
            ['jpg', 'jpeg', 'png', 'webp'],
            true
        );
    }
}
