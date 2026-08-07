<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * Sales Matrix → Consignee.
 *
 * Mirrors Customer (owns 1..N ConsigneeAddress rows, exactly one
 * flagged is_primary=true). Adds customer_id, the FK that ties this
 * consignee to the customer account it was created under.
 */
class Consignee extends Model
{
    use SoftDeletes;

    protected $fillable = [
        'client_id', 'branch_id', 'created_by',
        'customer_id',
        'consignee_code',
        'company_name', 'legal_name', 'segment', 'classification', 'risk_level',
        'website', 'primary_email', 'status',
        'same_as_customer',
    ];

    protected $casts = [
        'same_as_customer' => 'boolean',
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

    /** The "primary" customer — drives the Same-as-Customer KYC mirror and
     *  downstream party resolution. Also present in the customers() pivot. */
    public function customer(): BelongsTo
    {
        return $this->belongsTo(Customer::class);
    }

    /** All customers this consignee is mapped to (many-to-many, incl. primary). */
    public function customers(): \Illuminate\Database\Eloquent\Relations\BelongsToMany
    {
        return $this->belongsToMany(Customer::class, 'consignee_customer')
            ->withTimestamps()
            ->orderBy('customers.id');
    }

    public function addresses(): HasMany
    {
        return $this->hasMany(ConsigneeAddress::class)->orderByDesc('is_primary')->orderBy('id');
    }

    public function primaryAddress(): HasOne
    {
        return $this->hasOne(ConsigneeAddress::class)->where('is_primary', true);
    }

    /** Stage 2 — Company Due Diligence + Trade Licence rows. */
    public function documents(): HasMany
    {
        return $this->hasMany(ConsigneeDocument::class)->orderByDesc('id');
    }

    /** Stage 2 — Owner KYC rows. */
    public function owners(): HasMany
    {
        return $this->hasMany(ConsigneeOwner::class)->orderByDesc('id');
    }

    /**
     * Tenant visibility scope — mirrors Customer::scopeForUser by
     * delegating to the same creator-hierarchy rule. See Customer.php
     * for the role matrix.
     */
    public function scopeForUser(Builder $q, $user, ?int $branchFilter = null): Builder
    {
        // Sales AND Legal employees share the WHOLE branch's consignee book —
        // every member sees all the branch's consignees, not only the rows they
        // created (QA #14). Kept in step with Customer::scopeForUser on purpose:
        // a consignee is reached FROM a customer profile, so widening one book
        // without the other just moves the empty screen one click along.
        if (\App\Support\SalesVisibility::sharesBranchCustomerBook($user)) {
            \App\Support\MasterVisibility::applyBranchScope($q, $user);
            return $q;
        }

        // $branchFilter = BranchSwitcher narrowing; see Customer::scopeForUser.
        \App\Support\MasterVisibility::applyReadScope($q, $user, $branchFilter);
        return $q;
    }
}
