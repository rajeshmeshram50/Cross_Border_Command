<?php

namespace App\Models;

use App\Support\Concerns\EnforcesUniqueEmail;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Database\Eloquent\SoftDeletes;

class Customer extends Model
{
    use EnforcesUniqueEmail;
    protected static string $emailScope   = 'customer';
    protected static array  $emailColumns = ['primary_email'];

    use SoftDeletes;

    protected $fillable = [
        'client_id', 'branch_id', 'created_by',
        'customer_code',
        'company_name', 'legal_name', 'type', 'segment', 'segment_ids', 'classification', 'risk_level',
        'gst_applicable', 'gst_number',
        'website', 'primary_email', 'status', 'zoho_contact_id',
        'is_map_lead',
    ];

    protected $casts = [
        'segment_ids' => 'array',
    ];

    public static function markMappedToLead(?int $customerId): void
    {
        if (!$customerId) {
            return;
        }

        static::query()
            ->whereKey($customerId)
            ->where(fn ($q) => $q->where('is_map_lead', '!=', 'Yes')->orWhereNull('is_map_lead'))
            ->update(['is_map_lead' => 'Yes']);
    }

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

    public function documents(): HasMany
    {
        return $this->hasMany(CustomerDocument::class)->orderByDesc('id');
    }

    public function owners(): HasMany
    {
        return $this->hasMany(CustomerOwner::class)->orderByDesc('id');
    }

    public function gstScrutiny(): HasMany
    {
        return $this->hasMany(CustomerGstScrutiny::class)->orderByDesc('id');
    }

    public function consignees(): BelongsToMany
    {
        return $this->belongsToMany(Consignee::class, 'consignee_customer')
            ->withTimestamps()
            ->orderByDesc('consignees.id');
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
