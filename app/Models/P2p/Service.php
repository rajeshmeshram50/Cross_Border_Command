<?php

namespace App\Models\P2p;

use App\Models\Branch;
use App\Models\Client;
use App\Models\Masters\Conditions;
use App\Models\Masters\Departments;
use App\Models\Masters\HazClass;
use App\Models\Masters\HsnCodes;
use App\Models\Masters\PackagingMaterial;
use App\Models\Masters\Segments;
use App\Models\Masters\ServiceCategory;
use App\Models\Masters\Uom;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * P2P · Service Management — one service in the service catalogue.
 *
 * Three primary types and their classification (sub-type):
 *   self_consumable   → trackable | consumable
 *   soft_digital      → none (classification stays NULL)
 *   other_operational → professional | utility | facility | maintenance | outsourcing
 *
 * segment_id is the shared Segments master (clm_segments) — the same segments
 * products use.
 *
 * Lifecycle: draft (Stage 1 "Service Core Information" saved) → active
 * (Stage 2 "Map Service Suppliers" submitted). inactive is a manual switch.
 */
class Service extends Model
{
    use SoftDeletes;

    protected $table = 'p2p_services';

    public const TYPE_SELF  = 'self_consumable';
    public const TYPE_SOFT  = 'soft_digital';
    public const TYPE_OTHER = 'other_operational';

    public const STATUSES = ['draft', 'active', 'inactive'];

    /**
     * The service taxonomy. Order matters: it is the tab order of the list page
     * and the card order of the "Add Service" chooser.
     */
    public const TYPES = [
        self::TYPE_SELF => [
            'label'       => 'Self-Consumable Services',
            'short'       => 'Self-Consumable',
            'description' => 'Physical goods, equipment, assets and consumables purchased for internal use.',
            'classifications' => [
                'trackable'  => ['label' => 'Trackable Material / Goods',  'short' => 'Trackable',
                                 'description' => 'Laptops, desktops, printers, monitors, furniture — tracked one by one.'],
                'consumable' => ['label' => 'Consumable Material / Goods', 'short' => 'Consumable',
                                 'description' => 'Stationery, pantry supplies, cleaning materials, printer paper — tracked by quantity.'],
            ],
        ],
        self::TYPE_SOFT => [
            'label'       => 'Soft / Digital Services',
            'short'       => 'Soft / Digital',
            'description' => 'Software, platforms, subscriptions, APIs, licences and cloud services.',
            // No sub-type: a Soft / Digital service is classified by its category alone.
            'classifications' => [],
        ],
        self::TYPE_OTHER => [
            'label'       => 'Other Operational Services',
            'short'       => 'Other Operational',
            'description' => 'Professional, utility, facility, maintenance and outsourced services.',
            'classifications' => [
                'professional' => ['label' => 'Professional Services', 'short' => 'Professional', 'description' => 'CA, legal consultancy, accounting, HR consultancy.'],
                'utility'      => ['label' => 'Utility Services',      'short' => 'Utility',      'description' => 'Electricity, water supply, internet connectivity.'],
                'facility'     => ['label' => 'Facility Services',     'short' => 'Facility',     'description' => 'Housekeeping, security, pantry management.'],
                'maintenance'  => ['label' => 'Maintenance Services',  'short' => 'Maintenance',  'description' => 'AC maintenance, electrical repair, equipment AMC.'],
            ],
        ],
    ];

    /** Columns each type owns. Anything not listed for the saved type is nulled. */
    public const TYPE_FIELDS = [
        self::TYPE_SELF  => ['segment_id', 'haz_type', 'haz_class_id', 'condition_id', 'packaging_id', 'confidential_info'],
        self::TYPE_SOFT  => ['category_id', 'segment_id', 'delivery_type', 'contract_required', 'remark'],
        self::TYPE_OTHER => ['category_id', 'department_id', 'billing_frequency', 'contract_required', 'remark'],
    ];

    /** Type-specific columns across all types (used to null the ones a type doesn't own). */
    public const SWITCHABLE_FIELDS = [
        'category_id', 'segment_id', 'delivery_type', 'haz_type', 'haz_class_id', 'condition_id',
        'packaging_id', 'department_id', 'billing_frequency', 'contract_required', 'remark', 'confidential_info',
    ];

    public const DELIVERY_TYPES = ['Cloud / SaaS', 'On-Premise', 'Web / Browser', 'Mobile App', 'API', 'Remote Support', 'On-site Support', 'Hybrid'];
    public const BILLING_FREQUENCIES = ['Monthly', 'Quarterly', 'Half-yearly', 'Yearly', 'Per Use', 'One-time'];
    public const HAZ_TYPES = ['Non Hazardous', 'Hazardous'];

    protected $fillable = [
        'client_id', 'branch_id', 'created_by', 'updated_by',
        'code', 'name', 'description',
        'service_type', 'classification', 'category_id', 'provider_brand', 'delivery_type', 'haz_type',
        'segment_id', 'hsn_id', 'uom_id', 'haz_class_id', 'condition_id', 'packaging_id', 'department_id',
        'billing_frequency', 'gst_percentage', 'contract_required', 'remark', 'confidential_info',
        'status', 'step_completed',
    ];

    protected $casts = [
        'contract_required' => 'boolean',
        'gst_percentage'    => 'decimal:2',
        'step_completed'    => 'integer',
    ];

    protected $appends = ['service_type_label', 'classification_label'];

    public static function classificationsOf(string $type): array
    {
        return array_keys(self::TYPES[$type]['classifications'] ?? []);
    }

    public function getServiceTypeLabelAttribute(): ?string
    {
        return self::TYPES[$this->service_type]['label'] ?? null;
    }

    public function getClassificationLabelAttribute(): ?string
    {
        return self::TYPES[$this->service_type]['classifications'][$this->classification]['short'] ?? null;
    }

    /* ── Tenant ─────────────────────────────────────────────────────── */
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

    /* ── Masters ────────────────────────────────────────────────────── */
    public function category(): BelongsTo
    {
        return $this->belongsTo(ServiceCategory::class, 'category_id');
    }

    public function segment(): BelongsTo
    {
        return $this->belongsTo(Segments::class, 'segment_id');
    }

    public function hsn(): BelongsTo
    {
        return $this->belongsTo(HsnCodes::class, 'hsn_id');
    }

    public function uom(): BelongsTo
    {
        return $this->belongsTo(Uom::class, 'uom_id');
    }

    public function hazClass(): BelongsTo
    {
        return $this->belongsTo(HazClass::class, 'haz_class_id');
    }

    public function condition(): BelongsTo
    {
        return $this->belongsTo(Conditions::class, 'condition_id');
    }

    public function packaging(): BelongsTo
    {
        return $this->belongsTo(PackagingMaterial::class, 'packaging_id');
    }

    public function department(): BelongsTo
    {
        return $this->belongsTo(Departments::class, 'department_id');
    }

    /* ── Children ─────────────────────────────────────────────────────
     * No orderBy on the relations themselves: PostgreSQL rejects an ORDER BY
     * on aggregate queries (count()/max() through the relation). Callers that
     * need an order apply it when eager loading. */
    public function suppliers(): HasMany
    {
        return $this->hasMany(ServiceSupplier::class, 'service_id');
    }

    /** Mappings that count as "Mapped Suppliers" (inactive ones are kept for history). */
    public function activeSuppliers(): HasMany
    {
        return $this->hasMany(ServiceSupplier::class, 'service_id')->where('status', 'active');
    }

    public function images(): HasMany
    {
        return $this->hasMany(ServiceImage::class, 'service_id');
    }

    public function primaryImage(): HasOne
    {
        return $this->hasOne(ServiceImage::class, 'service_id')->where('is_primary', true);
    }

    public function attachments(): HasMany
    {
        return $this->hasMany(ServiceAttachment::class, 'service_id');
    }
}
