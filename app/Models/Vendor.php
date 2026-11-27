<?php

namespace App\Models;

use App\Support\Concerns\EnforcesUniqueEmail;
use App\Support\MasterBundleCache;
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
    use EnforcesUniqueEmail;
    protected static string $emailScope   = 'vendor';
    protected static array  $emailColumns = ['primary_email'];

    public static ?int $convertingSupplierId = null;

    public function sameEmailOwnerRows(): array
    {
        $ids = $this->exists
            ? \App\Models\P2p\Supplier::where('converted_vendor_id', $this->getKey())->pluck('id')->all()
            : [];
        if (static::$convertingSupplierId) {
            $ids[] = static::$convertingSupplierId;
        }

        return array_map(fn ($id) => ['table' => 'p2p_suppliers', 'id' => (int) $id], array_unique($ids));
    }

    use SoftDeletes;

    protected static function booted(): void
    {
        static::saved(fn () => MasterBundleCache::bump());
        static::deleted(fn () => MasterBundleCache::bump());
        static::restored(fn () => MasterBundleCache::bump());
    }

    protected $fillable = [
        'client_id', 'branch_id', 'created_by',
        'vendor_code',
        'company_name', 'legal_name', 'website',
        'gst_applicable', 'gst_number',
        'vendor_type_id', 'risk_level_id', 'supplier_category', 'vendor_behaviour_id',
        'segment_id', 'compliance_behaviour_id', 'classification_id',
        'primary_email', 'zoho_contact_id', 'status', 'step_completed',
    ];

    protected $casts = [
        'step_completed' => 'integer',
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

    public function classification(): BelongsTo
    {
        return $this->belongsTo(CustomerClassifications::class, 'classification_id');
    }

    public function segments(): BelongsToMany
    {
        return $this->belongsToMany(Segments::class, 'vendor_segments', 'vendor_id', 'segment_id');
    }

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

    public function scopeForUser(Builder $q, $user, ?int $branchFilter = null): Builder
    {
        if ($user && ($user->user_type ?? null) === 'employee') {
            \App\Support\MasterVisibility::applyBranchScope($q, $user);
            return $q;
        }
        \App\Support\MasterVisibility::applyReadScope($q, $user, $branchFilter);
        return $q;
    }
}
