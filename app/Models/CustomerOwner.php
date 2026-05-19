<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Owner / authorized signatory captured on Stage 2 → Owner KYC.
 *
 * Holds the owner's identity (name, designation, email, phone) plus
 * three identity-proof file paths (ID, address, photograph). File
 * paths are relative to the `public` disk root.
 */
class CustomerOwner extends Model
{
    protected $fillable = [
        'customer_id',
        'owner_name', 'designation', 'official_email', 'phone_number',
        'id_proof_path', 'address_proof_path', 'photograph_path',
        'status', 'created_by',
    ];

    public function customer(): BelongsTo
    {
        return $this->belongsTo(Customer::class);
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }
}
