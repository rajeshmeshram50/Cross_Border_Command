<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * Vendor Stage 2 — Bank account row. Multiple per vendor (the modal
 * lets the user add more via "+ Add More Bank"). Cancelled cheque
 * file path is denormalised on the row.
 */
class VendorBankAccount extends Model
{
    use SoftDeletes;

    protected $fillable = [
        'vendor_id', 'created_by',
        'bank_name', 'branch_name', 'account_number', 'ifsc',
        'branch_address', 'cheque_path',
    ];

    public function vendor(): BelongsTo
    {
        return $this->belongsTo(Vendor::class);
    }
}
