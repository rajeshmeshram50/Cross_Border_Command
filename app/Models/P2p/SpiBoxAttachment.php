<?php

namespace App\Models\P2p;

use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Support\Facades\Storage;

/**
 * A photo or document attached to a box — one row per file, so a box can carry
 * many.
 *
 *   box_item_id NULL  the file is about the carton
 *   box_item_id set   the file is about one product inside it
 *
 * Only metadata lives here; the file itself is on disk.
 * `created_at` only, so Eloquent must not look for `updated_at`.
 */
class SpiBoxAttachment extends Model
{
    use SoftDeletes;

    protected $table = 'p2p_spi_box_attachments';

    public const UPDATED_AT = null;

    protected $fillable = [
        'box_id', 'box_item_id', 'file_path', 'file_name', 'uploaded_by',
    ];

    /* file_path is relative to a disk whose identity the caller does not
       know, so the row answers with a usable address instead. */
    protected $appends = ['url', 'is_image'];

    public function box(): BelongsTo        { return $this->belongsTo(SpiBox::class, 'box_id'); }
    public function boxItem(): BelongsTo    { return $this->belongsTo(SpiBoxItem::class, 'box_item_id'); }
    public function uploadedBy(): BelongsTo { return $this->belongsTo(User::class, 'uploaded_by'); }

    /** About one product inside the box, rather than the carton itself. */
    public function isForProduct(): bool
    {
        return $this->box_item_id !== null;
    }

    /**
     * Where the browser can fetch it.
     *
     * Local disk gives "/storage/...", relative, so it resolves against
     * whatever origin is serving the app. Azure gives the absolute container
     * URL. Either way the caller just uses it.
     */
    public function getUrlAttribute(): ?string
    {
        if (!$this->file_path) return null;

        $disk = config('filesystems.documents') ?: config('filesystems.default', 'public');

        /* A disk that cannot build a URL must not take the whole response
           down — the row is still worth returning without one. */
        try { return Storage::disk($disk)->url($this->file_path); }
        catch (\Throwable) { return null; }
    }

    /** Whether it can be shown inline, or only downloaded. */
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
