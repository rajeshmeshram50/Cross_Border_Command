<?php

namespace App\Models;

use App\Models\Masters\Conditions;
use App\Models\Masters\GstPercentage;
use App\Models\Masters\HazClass;
use App\Models\Masters\HsnCodes;
use App\Models\Masters\PackagingMaterial;
use App\Models\Masters\Segments;
use App\Models\Masters\Uom;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class Product extends Model
{
    use HasFactory, SoftDeletes;

    protected $fillable = [
        'client_id', 'branch_id', 'created_by',
        'product_code', 'name', 'generic_name', 'description', 'brand',
        'segment_id', 'haz_type', 'haz_class_id', 'uom_id', 'hsn_id',
        'condition_id', 'packaging_material_id', 'confidential_info',
        'primary_image', 'secondary_images',
        'base_price', 'gst_id', 'gst_amount', 'total_price', 'mark_bottom',
        'net_weight', 'gross_weight', 'length_cm', 'width_cm', 'height_cm',
        'batch_no', 'serial_no', 'cat_no', 'lot_no',
        'status', 'step_completed',
    ];

    protected $casts = [
        'secondary_images' => 'array',
        'base_price'       => 'decimal:2',
        'gst_amount'       => 'decimal:2',
        'total_price'      => 'decimal:2',
        'net_weight'       => 'decimal:3',
        'gross_weight'     => 'decimal:3',
        'length_cm'        => 'decimal:2',
        'width_cm'         => 'decimal:2',
        'height_cm'        => 'decimal:2',
        'step_completed'   => 'integer',
    ];

    /**
     * Auto-append the resolved URLs alongside the raw paths so the frontend
     * can render images without knowing the storage layout. Mirrors the
     * `profile_photo_url` accessor pattern used on Client and Branch.
     */
    protected $appends = ['primary_image_url', 'secondary_images_url'];

    public function getPrimaryImageUrlAttribute(): ?string
    {
        $p = $this->primary_image;
        // `blob:` URLs are browser-session-only and never resolvable on the
        // server. Treat them as empty so we don't emit `/storage/blob:...`.
        if (!$p || str_starts_with((string) $p, 'blob:')) {
            return null;
        }
        return file_url($p);
    }

    public function getSecondaryImagesUrlAttribute(): array
    {
        if (!is_array($this->secondary_images)) {
            return [];
        }
        return collect($this->secondary_images)
            ->filter(fn ($v) => is_string($v) && $v !== '' && !str_starts_with($v, 'blob:'))
            ->map(fn ($p) => file_url((string) $p))
            ->filter()
            ->values()
            ->all();
    }

    /* ── Relations ───────────────────────────────────────────────────── */

    public function client(): BelongsTo
    {
        return $this->belongsTo(Client::class);
    }

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function segment(): BelongsTo
    {
        return $this->belongsTo(Segments::class, 'segment_id');
    }

    public function hazClass(): BelongsTo
    {
        return $this->belongsTo(HazClass::class, 'haz_class_id');
    }

    public function uom(): BelongsTo
    {
        return $this->belongsTo(Uom::class, 'uom_id');
    }

    public function hsn(): BelongsTo
    {
        return $this->belongsTo(HsnCodes::class, 'hsn_id');
    }

    public function condition(): BelongsTo
    {
        return $this->belongsTo(Conditions::class, 'condition_id');
    }

    public function packagingMaterial(): BelongsTo
    {
        return $this->belongsTo(PackagingMaterial::class, 'packaging_material_id');
    }

    public function gstPercentage(): BelongsTo
    {
        return $this->belongsTo(GstPercentage::class, 'gst_id');
    }

    public function qcRecords(): HasMany
    {
        return $this->hasMany(ProductQcRecord::class);
    }

    public function vendorMaps(): HasMany
    {
        return $this->hasMany(ProductVendorMap::class);
    }

    /* ── Helpers ─────────────────────────────────────────────────────── */

    /**
     * Resolve the next pending step (1 = Core, 2 = Sales, 3 = Quality, 4 = Vendor).
     * Used by the frontend to re-open the wizard at the right place.
     */
    public function nextStep(): int
    {
        return min(($this->step_completed ?? 0) + 1, 4);
    }
}
