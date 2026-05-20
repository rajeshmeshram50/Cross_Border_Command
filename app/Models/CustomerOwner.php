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

    /**
     * Auto-append resolved URLs for the three identity-proof slots —
     * same pattern Client (logo_url, favicon_url, profile_photo_url)
     * uses. Frontend reads the *_url field directly; we don't have to
     * remember to build URLs in every controller shape() method.
     */
    protected $appends = ['id_proof_url', 'address_proof_url', 'photograph_url'];

    public function getIdProofUrlAttribute(): ?string
    {
        return file_url($this->id_proof_path);
    }

    public function getAddressProofUrlAttribute(): ?string
    {
        return file_url($this->address_proof_path);
    }

    public function getPhotographUrlAttribute(): ?string
    {
        return file_url($this->photograph_path);
    }

    public function customer(): BelongsTo
    {
        return $this->belongsTo(Customer::class);
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }
}
