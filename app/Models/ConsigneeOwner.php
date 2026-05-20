<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Owner / authorized signatory captured on Stage 2 → Owner KYC of
 * the Add Consignee modal.
 *
 * Holds the owner's identity (name, designation, email, phone) plus
 * three identity-proof file paths (ID, address, photograph). File
 * paths are relative to the `public` disk root.
 */
class ConsigneeOwner extends Model
{
    protected $fillable = [
        'consignee_id',
        'owner_name', 'designation', 'official_email', 'phone_number',
        'id_proof_path', 'address_proof_path', 'photograph_path',
        'status', 'created_by',
    ];

    /**
     * Auto-append resolved URLs for the three identity-proof slots —
     * same pattern Client (logo_url, favicon_url, profile_photo_url)
     * uses. The frontend reads *_url directly; controllers don't have
     * to build URLs themselves.
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

    public function consignee(): BelongsTo
    {
        return $this->belongsTo(Consignee::class);
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }
}
