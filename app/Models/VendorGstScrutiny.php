<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * Vendor Stage 2 — GST scrutiny entry. One row per GST number the
 * vendor is registered under (multi-state vendors can have several).
 */
class VendorGstScrutiny extends Model
{
    use SoftDeletes;

    // Explicit table name — Eloquent's default pluralisation would
    // turn this class into `vendor_gst_scrutinies` which doesn't
    // match the migration's table name.
    protected $table = 'vendor_gst_scrutiny';

    protected $fillable = [
        'vendor_id', 'created_by',
        'gst_number', 'status', 'last_filing_date',
        'prev_non_gst_2a_invoice', 'red_flags',
    ];

    protected $casts = [
        'last_filing_date' => 'date',
    ];

    public function vendor(): BelongsTo
    {
        return $this->belongsTo(Vendor::class);
    }
}
