<?php

namespace App\Models;

use App\Support\Concerns\EnforcesUniqueEmail;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Database\Eloquent\SoftDeletes;

class Consignee extends Model
{
    use EnforcesUniqueEmail;
    protected static string $emailScope   = 'consignee';
    protected static array  $emailColumns = ['primary_email'];

    use SoftDeletes;

    protected $fillable = [
        'client_id', 'branch_id', 'created_by',
        'customer_id',
        'consignee_code',
        'company_name', 'legal_name', 'segment', 'segment_ids', 'classification', 'risk_level',
        'website', 'primary_email', 'status',
        'same_as_customer',
    ];

    protected $casts = [
        'same_as_customer' => 'boolean',
        'segment_ids'      => 'array',
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

    public function documents(): HasMany
    {
        return $this->hasMany(ConsigneeDocument::class)->orderByDesc('id');
    }

    public function owners(): HasMany
    {
        return $this->hasMany(ConsigneeOwner::class)->orderByDesc('id');
    }

    public function scopeForUser(Builder $q, $user, ?int $branchFilter = null): Builder
    {
        if (\App\Support\SalesVisibility::sharesBranchCustomerBook($user)) {
            \App\Support\MasterVisibility::applyBranchScope($q, $user);
            return $q;
        }

        \App\Support\MasterVisibility::applyReadScope($q, $user, $branchFilter);
        return $q;
    }
}
