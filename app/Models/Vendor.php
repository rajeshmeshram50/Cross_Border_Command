<?php

namespace App\Models;

use App\Models\Masters\ComplianceBehaviours;
use App\Models\Masters\RiskLevels;
use App\Models\Masters\Segments;
use App\Models\Masters\VendorBehaviour;
use App\Models\Masters\VendorTypes;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
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
        'segment_id', 'compliance_behaviour_id',
        'primary_email', 'status', 'step_completed',
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
    public function scopeForUser(Builder $q, $user): Builder
    {
        \App\Support\MasterVisibility::applyReadScope($q, $user);
        return $q;
    }
}
