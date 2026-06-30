<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * Customer GST Scrutiny entry — mirrors {@see VendorGstScrutiny}.
 * One row per GST number a domestic customer is registered under.
 */
class CustomerGstScrutiny extends Model
{
    use SoftDeletes;

    protected $table = 'customer_gst_scrutiny';

    protected $fillable = [
        'customer_id', 'created_by',
        'gst_number', 'status', 'last_filing_date',
        'prev_non_gst_2a_invoice', 'red_flags',
    ];

    protected $casts = [
        'last_filing_date' => 'date',
    ];

    public function customer(): BelongsTo
    {
        return $this->belongsTo(Customer::class);
    }
}
