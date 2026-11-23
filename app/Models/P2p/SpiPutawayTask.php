<?php

namespace App\Models\P2p;

use App\Models\Branch;
use App\Models\Client;
use App\Models\Concerns\BelongsToTenant;
use App\Models\Inventory\LocationOccupancy;
use App\Models\Inventory\Rack;
use App\Models\Inventory\Shelf;
use App\Models\Inventory\Warehouse;
use App\Models\Inventory\Zone;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class SpiPutawayTask extends Model
{
    use BelongsToTenant;

    protected $table = 'p2p_spi_putaway_tasks';

    public const PENDING   = 'pending';
    public const SCANNED   = 'scanned';
    public const FAILED    = 'failed';
    public const CANCELLED = 'cancelled';
    public const EXPIRED   = 'expired';

    public const DEFAULT_TTL_HOURS = 8;

    protected $fillable = [
        'client_id', 'branch_id', 'supplier_invoice_id', 'putaway_id', 'box_id', 'occupancy_id',
        'task_code',
        'warehouse_id', 'zone_id', 'rack_id', 'shelf_id',
        'required_scans', 'completed_scans', 'box_scan_at', 'shelf_scan_at',
        'box_confirmed_at', 'shelf_confirmed_at', 'fail_count',
        'zone_scan_at', 'rack_scan_at',
        'status', 'capacity_reserved_pct',
        'issued_at', 'issued_by', 'device_id', 'device_serial',
        'completed_at', 'cancelled_at', 'cancelled_by', 'failed_reason', 'expires_at',
        'created_by', 'updated_by',
    ];

    protected $casts = [
        'box_scan_at'           => 'datetime',
        'shelf_scan_at'         => 'datetime',
        'box_confirmed_at'      => 'datetime',
        'shelf_confirmed_at'    => 'datetime',
        'zone_scan_at'          => 'datetime',
        'rack_scan_at'          => 'datetime',
        'issued_at'             => 'datetime',
        'completed_at'          => 'datetime',
        'cancelled_at'          => 'datetime',
        'expires_at'            => 'datetime',
        'capacity_reserved_pct' => 'decimal:2',
    ];

    public function client(): BelongsTo    { return $this->belongsTo(Client::class); }
    public function branch(): BelongsTo    { return $this->belongsTo(Branch::class); }
    public function invoice(): BelongsTo   { return $this->belongsTo(SupplierInvoice::class, 'supplier_invoice_id'); }
    public function putaway(): BelongsTo   { return $this->belongsTo(SpiPutaway::class, 'putaway_id'); }
    public function box(): BelongsTo       { return $this->belongsTo(SpiBox::class, 'box_id'); }
    public function occupancy(): BelongsTo { return $this->belongsTo(LocationOccupancy::class, 'occupancy_id'); }
    public function warehouse(): BelongsTo { return $this->belongsTo(Warehouse::class, 'warehouse_id'); }
    public function zone(): BelongsTo      { return $this->belongsTo(Zone::class, 'zone_id'); }
    public function rack(): BelongsTo      { return $this->belongsTo(Rack::class, 'rack_id'); }
    public function shelf(): BelongsTo     { return $this->belongsTo(Shelf::class, 'shelf_id'); }
    public function issuedBy(): BelongsTo  { return $this->belongsTo(User::class, 'issued_by'); }

    public function scopeOpen(Builder $q): Builder
    {
        return $q->where('status', self::PENDING);
    }

    public function isOpen(): bool
    {
        return $this->status === self::PENDING;
    }

    public const MAX_FAILS = 3;

    public function locationSlot(): string
    {
        return $this->shelf_id ? 'shelf' : 'zone';
    }

    public function locationChain(): array
    {
        $out = [];

        if ($this->zone_id)  $out[] = ['kind' => 'zone',  'id' => (int) $this->zone_id,  'scanned' => $this->zone_scan_at !== null];
        if ($this->rack_id)  $out[] = ['kind' => 'rack',  'id' => (int) $this->rack_id,  'scanned' => $this->rack_scan_at !== null];
        if ($this->shelf_id) $out[] = ['kind' => 'shelf', 'id' => (int) $this->shelf_id, 'scanned' => $this->shelf_scan_at !== null];

        return $out;
    }

    public function levelIdFor(string $kind): ?int
    {
        return match ($kind) {
            'zone'  => $this->zone_id ? (int) $this->zone_id : null,
            'rack'  => $this->rack_id ? (int) $this->rack_id : null,
            'shelf' => $this->shelf_id ? (int) $this->shelf_id : null,
            default => null,
        };
    }

    public function markLocationScanned(string $kind): void
    {
        $now    = now();
        $fields = [];

        if ($kind === 'shelf') {
            $fields = [
                'shelf_scan_at' => $now,
                'rack_scan_at'  => $this->rack_scan_at ?: ($this->rack_id ? $now : null),
                'zone_scan_at'  => $this->zone_scan_at ?: ($this->zone_id ? $now : null),
            ];
        } elseif ($kind === 'rack') {
            $fields = [
                'rack_scan_at' => $now,
                'zone_scan_at' => $this->zone_scan_at ?: ($this->zone_id ? $now : null),
            ];
        } elseif ($kind === 'zone') {
            $fields = $this->shelf_id || $this->rack_id
                ? ['zone_scan_at' => $now]
                : ['zone_scan_at' => $now, 'shelf_scan_at' => $now];
        }

        $this->forceFill($fields)->save();
    }

    public function lastScanAt(): ?\Illuminate\Support\Carbon
    {
        $times = array_filter([
            $this->box_scan_at, $this->box_confirmed_at,
            $this->zone_scan_at, $this->rack_scan_at,
            $this->shelf_scan_at, $this->shelf_confirmed_at,
        ]);

        return $times ? max($times) : null;
    }

    public function scansAreStale(?int $minutes = null): bool
    {
        $last = $this->lastScanAt();
        if (!$last || $this->readyToComplete()) return false;

        return $last->lt(now()->subMinutes($minutes ?? (int) config('inventory.scan_stale_minutes', 30)));
    }

    public function idleSecondsLeft(?int $minutes = null): ?int
    {
        $last = $this->lastScanAt();
        if (!$last || $this->readyToComplete() || !$this->isOpen()) return null;

        $window = ($minutes ?? (int) config('inventory.scan_stale_minutes', 5)) * 60;

        return (int) max(0, $window - (int) abs($last->diffInSeconds(now())));
    }

    public function nextLocationLevel(): ?string
    {
        foreach ($this->locationChain() as $step) {
            if (!$step['scanned']) return $step['kind'];
        }

        return null;
    }

    public function currentStep(): ?string
    {
        if (!$this->box_scan_at)   return 'scan_box';
        if (!$this->shelf_scan_at) return 'scan_' . $this->locationSlot();

        return 'complete';
    }

    public function stepLabel(): string
    {
        if ($this->currentStep() === 'scan_box') return 'Scan the box';
        if ($this->currentStep() === 'complete') return 'Both matched — press Complete';

        $next = $this->nextLocationLevel();

        return $next === 'shelf' && ($this->zone_scan_at || $this->rack_scan_at)
            ? 'Now scan the shelf'
            : 'Scan the ' . ($next ?: 'location');
    }

    public function expectedScans(): array
    {
        return array_values(array_filter([
            $this->box_scan_at ? null : 'box',
            $this->shelf_scan_at ? null : $this->locationSlot(),
        ]));
    }

    public function readyToComplete(): bool
    {
        return $this->box_scan_at !== null && $this->shelf_scan_at !== null;
    }

    public function resetScans(): void
    {
        $this->forceFill([
            'box_scan_at'        => null,
            'box_confirmed_at'   => null,
            'shelf_scan_at'      => null,
            'shelf_confirmed_at' => null,
            'completed_scans'    => 0,
            'fail_count'         => 0,
        ])->save();
    }

    public function nextScan(): ?string
    {
        if ($this->box_scan_at === null)   return 'box';
        if ($this->shelf_scan_at === null) return $this->locationSlot();

        return null;
    }
}
