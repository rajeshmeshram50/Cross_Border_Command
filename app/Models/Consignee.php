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

    public function customer(): BelongsTo
    {
        return $this->belongsTo(Customer::class);
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
     * Tenant visibility scope — mirrors Customer::scopeForUser exactly
     * so the rule lives in one shape and only changes in two files
     * when roles evolve. See Customer.php for the role matrix.
     */
    public function scopeForUser(Builder $q, $user): Builder
    {
        if (!$user) return $q->whereRaw('1 = 0');
        if ($user->user_type === 'super_admin') return $q;
        if (in_array($user->user_type, ['client_admin', 'client_user'], true)) {
            return $q->where('client_id', $user->client_id);
        }
        if (in_array($user->user_type, ['branch_user', 'employee'], true)) {
            $clientId = $user->client_id ?? ($user->branch?->client_id);
            return $q->where('client_id', $clientId);
        }
        return $q->whereRaw('1 = 0');
    }
}
