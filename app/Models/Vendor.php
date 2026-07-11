<?php

namespace App\Models;

use App\Models\Masters\ComplianceBehaviours;
use App\Models\Masters\CustomerClassifications;
use App\Models\Masters\RiskLevels;
use App\Models\Masters\Segments;
use App\Models\Masters\VendorBehaviour;
use App\Models\Masters\VendorTypes;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Database\Eloquent\SoftDeletes;


class Vendor extends Model
{
    use SoftDeletes;

    protected $fillable = [
        'client_id', 'branch_id', 'created_by',
        'vendor_code',
        'company_name', 'legal_name', 'website',
        'vendor_type_id', 'risk_level_id', 'vendor_behaviour_id',
        'segment_id', 'compliance_behaviour_id', 'classification_id',
        'primary_email', 'zoho_contact_id', 'status', 'step_completed',
    ];

    protected $casts = [
        'step_completed' => 'integer',
    ];

    /* ── Tenant relations ─────────────────────────────────────────── */
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

    /* ── Master FK relations (for label rendering on read) ────────── */
    public function vendorType(): BelongsTo
    {
        return $this->belongsTo(VendorTypes::class, 'vendor_type_id');
    }

    public function riskLevel(): BelongsTo
    {
        return $this->belongsTo(RiskLevels::class, 'risk_level_id');
    }

    public function vendorBehaviour(): BelongsTo
    {
        return $this->belongsTo(VendorBehaviour::class, 'vendor_behaviour_id');
    }

    public function segment(): BelongsTo
    {
        return $this->belongsTo(Segments::class, 'segment_id');
    }

    public function complianceBehaviour(): BelongsTo
    {
        return $this->belongsTo(ComplianceBehaviours::class, 'compliance_behaviour_id');
    }

    /** "Classification & Flags" — FK to the shared classification master. */
    public function classification(): BelongsTo
    {
        return $this->belongsTo(CustomerClassifications::class, 'classification_id');
    }

    /**
     * Supplier Segment is multi-select. The full set lives in the
     * vendor_segments pivot; the scalar segment_id keeps the first one.
     */
    public function segments(): BelongsToMany
    {
        return $this->belongsToMany(Segments::class, 'vendor_segments', 'vendor_id', 'segment_id');
    }

    /* ── Child rows ───────────────────────────────────────────────── */
    public function addresses(): HasMany
    {
        return $this->hasMany(VendorAddress::class)
            ->orderByDesc('is_primary')
            ->orderBy('id');
    }

    public function primaryAddress(): HasOne
    {
        return $this->hasOne(VendorAddress::class)->where('is_primary', true);
    }

    public function documents(): HasMany
    {
        return $this->hasMany(VendorDocument::class)->orderBy('id');
    }

    public function owners(): HasMany
    {
        return $this->hasMany(VendorOwner::class)->orderBy('id');
    }

    public function bankAccounts(): HasMany
    {
        return $this->hasMany(VendorBankAccount::class)->orderBy('id');
    }

    public function gstScrutiny(): HasMany
    {
        return $this->hasMany(VendorGstScrutiny::class)->orderBy('id');
    }

    public function productMappings(): HasMany
    {
        return $this->hasMany(VendorProductMapping::class)->orderBy('id');
    }

    /**
     * Tenant visibility scope — delegates to MasterVisibility so the
     * vendors module shares the exact same creator-hierarchy rule as
     * customers, consignees and products. See Customer.php for the
     * full role matrix.
     *
     * Usage:
     *   Vendor::query()->forUser($user)->where(...)
     */
    public function scopeForUser(Builder $q, $user, ?int $branchFilter = null): Builder
    {
        // $branchFilter = BranchSwitcher narrowing; see Customer::scopeForUser.
        \App\Support\MasterVisibility::applyReadScope($q, $user, $branchFilter);
        return $q;
    }
}
