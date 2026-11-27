<?php

namespace App\Models\P2p;

use App\Models\Branch;
use App\Models\Client;
use App\Models\Inventory\Warehouse;
use App\Models\Concerns\BelongsToTenant;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

class SpiPutaway extends Model
{
    use BelongsToTenant, SoftDeletes;

    protected $table = 'p2p_spi_putaways';

    public const SCAN_TYPES = ['box', 'location', 'rack', 'shelf'];
    public const CONDITIONS = ['perfect', 'minor', 'major', 'severe'];

    public const PENDING       = 'pending';
    public const DRAFT         = 'draft';
    public const AWAITING_SCAN = 'awaiting_scan';
    public const PLACED        = 'placed';

    protected $fillable = [
        'client_id', 'branch_id', 'supplier_invoice_id', 'box_id',
        'warehouse_id', 'zone_id', 'rack_id', 'shelf_id', 'destination',
        'status', 'assigned_at', 'assigned_by',
        'box_scanned_at', 'location_scanned_at', 'rack_scanned_at', 'shelf_scanned_at',
        'device_id', 'device_serial', 'scanned_by',
        'confirmed_at', 'confirmed_by', 'condition_at_putaway',
    ];

    protected $casts = [
        'assigned_at'         => 'datetime',
        'box_scanned_at'      => 'datetime',
        'location_scanned_at' => 'datetime',
        'rack_scanned_at'     => 'datetime',
        'shelf_scanned_at'    => 'datetime',
        'confirmed_at'        => 'datetime',
    ];

    public function client(): BelongsTo      { return $this->belongsTo(Client::class); }
    public function branch(): BelongsTo      { return $this->belongsTo(Branch::class); }
    public function invoice(): BelongsTo     { return $this->belongsTo(SupplierInvoice::class, 'supplier_invoice_id'); }
    public function box(): BelongsTo         { return $this->belongsTo(SpiBox::class, 'box_id'); }
    public function warehouse(): BelongsTo   { return $this->belongsTo(Warehouse::class, 'warehouse_id'); }
    public function scannedBy(): BelongsTo   { return $this->belongsTo(User::class, 'scanned_by'); }
    public function confirmedBy(): BelongsTo { return $this->belongsTo(User::class, 'confirmed_by'); }

    public function isPlaced(): bool
    {
        return $this->confirmed_at !== null;
    }

    public function nextScan(bool $fullPutaway = true): ?string
    {
        if ($this->box_scanned_at === null)      return 'box';
        if ($this->location_scanned_at === null) return 'location';
        if (!$fullPutaway)                       return null;
        if ($this->rack_scanned_at === null)     return 'rack';
        if ($this->shelf_scanned_at === null)    return 'shelf';

        return null;
    }

    public function isReadyToConfirm(bool $fullPutaway = true): bool
    {
        return $this->nextScan($fullPutaway) === null && !$this->isPlaced();
    }

    public function stage4Status(bool $hasOpenTask = false): string
    {
        if ($this->confirmed_at) return 'placed';
        if ($hasOpenTask)        return 'awaiting_scan';
        if ($this->shelf_id || $this->zone_id) return 'draft';

        return 'pending';
    }

    public function draftSince(): ?string
    {
        return $this->confirmed_at ? null : optional($this->updated_at)->toDateTimeString();
    }

    public const STEPS = [
        self::PENDING       => [1, 'Review Box'],
        self::DRAFT         => [3, 'Confirm Placement'],
        self::AWAITING_SCAN => [3, 'Confirm Placement · awaiting scan'],
        self::PLACED        => [4, 'Putaway Summary'],
    ];

    public static function stepFor(string $status): array
    {
        [$no, $label] = self::STEPS[$status] ?? self::STEPS[self::PENDING];

        return ['current_step' => $no, 'current_step_label' => $label];
    }
}
