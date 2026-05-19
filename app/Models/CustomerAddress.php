<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A single address + contact-person tuple attached to a Customer.
 *
 * The legacy frontend kept "Address" and "Contact Person" as two
 * parallel tables with identical fields; this merged shape is what
 * actually gets persisted now. `is_primary` marks the one captured
 * on Stage 1 of the modal (always exactly one per customer).
 */
class CustomerAddress extends Model
{
    protected $fillable = [
        'customer_id',
        'type', 'address_line', 'country', 'state', 'city', 'pin',
        'cp_name', 'cp_designation', 'cp_contact', 'cp_email', 'cp_whatsapp',
        'is_primary',
    ];

    protected $casts = [
        'is_primary' => 'boolean',
    ];

    public function customer(): BelongsTo
    {
        return $this->belongsTo(Customer::class);
    }
}