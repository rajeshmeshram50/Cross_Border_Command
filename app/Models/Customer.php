<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
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
        'gst_applicable', 'gst_number',
        'website', 'primary_email', 'status', 'zoho_contact_id',
        'is_map_lead',
    ];

    /**
     * Flip the customer to "mapped to a lead" — called the moment an
     * opportunity is created against it or an existing one is re-pointed at
     * it. Idempotent and deliberately cheap: a single conditional UPDATE, no
     * model events, so it can sit inside the lead-save transaction without
     * dragging observers along. Once 'Yes' the country is frozen (see
     * CustomerController::mappedLeadCountryDenial).
     */
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

    /** GST Scrutiny rows (domestic / India customers). Mirrors the
     *  vendor side; managed from the "GST Scrutiny" popup on the modal. */
    public function gstScrutiny(): HasMany
    {
        return $this->hasMany(CustomerGstScrutiny::class)->orderByDesc('id');
    }

    /** Consignees mapped to this customer (Sales Matrix → Consignee).
     *  Many-to-many now — a consignee can be mapped to several customers.
     *  Eager-counted on the list endpoint via withCount('consignees'). */
    public function consignees(): BelongsToMany
    {
        return $this->belongsToMany(Consignee::class, 'consignee_customer')
            ->withTimestamps()
            ->orderByDesc('consignees.id');
    }

    /**
     * Tenant visibility scope for the customers table. Delegates to the
     * shared creator-hierarchy rule so the customer + consignee modules
     * stay aligned with master data:
     *
     *   - super_admin:                  sees everything
     *   - client_admin | client_user:   their client's rows
     *   - branch_user:                  client-level + their own branch's
     *                                   rows (sibling branches are blocked —
     *                                   every branch is an isolated peer)
     *
     * Usage:
     *   Customer::query()->forUser($user)->where(...)
     */
    public function scopeForUser(Builder $q, $user, ?int $branchFilter = null): Builder
    {
        // Sales-department employees share the WHOLE branch's customer book —
        // every Sales employee (not just the branch admin or HOD) sees all the
        // branch's customers, not only the rows they created (QA #14). Other
        // employees stay peer-isolated via applyReadScope below.
        if (\App\Support\SalesVisibility::isSalesDepartmentEmployee($user)) {
            \App\Support\MasterVisibility::applyBranchScope($q, $user);
            return $q;
        }

        // $branchFilter is the BranchSwitcher's narrowing — only honoured for
        // client admins inside applyReadScope; silently ignored for branch
        // users & employees.
        \App\Support\MasterVisibility::applyReadScope($q, $user, $branchFilter);
        return $q;
    }
}