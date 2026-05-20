<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * Sales Matrix → Customer.
 *
 * Owns 1..N CustomerAddress rows. Exactly one of those is flagged
 * is_primary=true — that's the address+contact entered on Stage 1
 * of the Add Customer modal. Additional rows come from the
 * "Additional Locations & Contacts" table.
 *
 * `primary_email` mirrors the primary contact's email so the unique
 * check on save is a single-column lookup (scoped per tenant).
 */
class Customer extends Model
{
    use SoftDeletes;

    protected $fillable = [
        'client_id', 'branch_id', 'created_by',
        'customer_code',
        'company_name', 'legal_name', 'type', 'segment', 'classification', 'risk_level',
        'website', 'primary_email', 'status',
    ];

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

    public function addresses(): HasMany
    {
        return $this->hasMany(CustomerAddress::class)->orderByDesc('is_primary')->orderBy('id');
    }

    public function primaryAddress(): HasOne
    {
        return $this->hasOne(CustomerAddress::class)->where('is_primary', true);
    }

    /** Stage 2 — Company Due Diligence + Trade Licence rows. */
    public function documents(): HasMany
    {
        return $this->hasMany(CustomerDocument::class)->orderByDesc('id');
    }

    /** Stage 2 — Owner KYC rows. */
    public function owners(): HasMany
    {
        return $this->hasMany(CustomerOwner::class)->orderByDesc('id');
    }

    /** Consignees mapped to this customer (Sales Matrix → Consignee).
     *  Eager-counted on the list endpoint via withCount('consignees'). */
    public function consignees(): HasMany
    {
        return $this->hasMany(Consignee::class)->orderByDesc('id');
    }

    /**
     * Tenant visibility scope for the customers table. Delegates to the
     * shared creator-hierarchy rule so the customer + consignee modules
     * stay aligned with master data:
     *
     *   - super_admin:                  sees everything
     *   - client_admin | client_user:   their client's rows
     *   - main-branch member:           their client's rows
     *   - sub-branch member:            client-level + main-branch + own
     *                                   sub-branch (sibling sub-branches
     *                                   are blocked)
     *
     * Usage:
     *   Customer::query()->forUser($user)->where(...)
     */
    public function scopeForUser(Builder $q, $user): Builder
    {
        \App\Support\MasterVisibility::applyReadScope($q, $user);
        return $q;
    }
}