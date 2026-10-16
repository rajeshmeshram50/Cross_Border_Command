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

/**
 * P2P · a box handed to the warehouse floor for Zebra verification.
 *
 * Stage 04 confirms a placement two ways and they do not end in the same
 * place. Manual COMPLETES NOW. This one CREATES A SCAN TASK: the box leaves the
 * screen, sits in a queue, and is closed by a handheld that may be offline for
 * hours. Work that outlives the request that made it needs its own row.
 *
 * NOT p2p_spi_scan_logs. That logs every ATTEMPT, good and bad, forever. This
 * is the OUTSTANDING WORK — "what is still open on the floor", which needs only
 * the handful of pending rows.
 *
 * The expected address is copied here rather than read from the put-away row,
 * because what the operator was TOLD to scan is what a mismatch must be judged
 * against. A scan can confirm the instruction or refuse it; it never rewrites
 * it.
 */
class SpiPutawayTask extends Model
{
    use BelongsToTenant;

    protected $table = 'p2p_spi_putaway_tasks';

    public const PENDING   = 'pending';
    public const SCANNED   = 'scanned';
    public const FAILED    = 'failed';
    public const CANCELLED = 'cancelled';
    public const EXPIRED   = 'expired';

    /** How long an unanswered task stays open before it is reaped. */
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

    /** Refusals in a row before the operator is sent back to the box. */
    public const MAX_FAILS = 3;

    /**
     * Which location sticker this task expects — a shelf, or the zone itself
     * in a warehouse that stores without racks.
     */
    public function locationSlot(): string
    {
        return $this->shelf_id ? 'shelf' : 'zone';
    }

    /**
     * The address as a chain, deepest last: zone → rack → shelf.
     *
     * Only levels this task actually has. A rackless zone's chain is one
     * level, and the last entry is what finishes the location.
     *
     * @return array<int, array{kind:string,id:int,scanned:bool}>
     */
    public function locationChain(): array
    {
        $out = [];

        if ($this->zone_id)  $out[] = ['kind' => 'zone',  'id' => (int) $this->zone_id,  'scanned' => $this->zone_scan_at !== null];
        if ($this->rack_id)  $out[] = ['kind' => 'rack',  'id' => (int) $this->rack_id,  'scanned' => $this->rack_scan_at !== null];
        if ($this->shelf_id) $out[] = ['kind' => 'shelf', 'id' => (int) $this->shelf_id, 'scanned' => $this->shelf_scan_at !== null];

        return $out;
    }

    /** Which level a given scan kind maps to on this task, or null. */
    public function levelIdFor(string $kind): ?int
    {
        return match ($kind) {
            'zone'  => $this->zone_id ? (int) $this->zone_id : null,
            'rack'  => $this->rack_id ? (int) $this->rack_id : null,
            'shelf' => $this->shelf_id ? (int) $this->shelf_id : null,
            default => null,
        };
    }

    /**
     * Scanning a level implies every level ABOVE it.
     *
     * A shelf sits in exactly one rack, inside exactly one zone — reading the
     * shelf label is already proof the operator is standing in both. Marking
     * them keeps the progress display honest without asking for scans that
     * could not possibly fail.
     */
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
            // A rackless task is finished by its zone; otherwise it is a step.
            $fields = $this->shelf_id || $this->rack_id
                ? ['zone_scan_at' => $now]
                : ['zone_scan_at' => $now, 'shelf_scan_at' => $now];
        }

        $this->forceFill($fields)->save();
    }

    /** The most recent scan of any kind on this task. */
    public function lastScanAt(): ?\Illuminate\Support\Carbon
    {
        $times = array_filter([
            $this->box_scan_at, $this->box_confirmed_at,
            $this->zone_scan_at, $this->rack_scan_at,
            $this->shelf_scan_at, $this->shelf_confirmed_at,
        ]);

        return $times ? max($times) : null;
    }

    /**
     * Half-scanned and left alone too long.
     *
     * Only a PARTIAL run goes stale. A task nobody has touched is not stale,
     * it is simply waiting, and one that is ready to complete has done the
     * work — expiring either would be throwing away something correct.
     */
    public function scansAreStale(?int $minutes = null): bool
    {
        $last = $this->lastScanAt();
        if (!$last || $this->readyToComplete()) return false;

        return $last->lt(now()->subMinutes($minutes ?? (int) config('inventory.scan_stale_minutes', 30)));
    }

    /** The deepest level still unscanned — what the operator owes. */
    public function nextLocationLevel(): ?string
    {
        foreach ($this->locationChain() as $step) {
            if (!$step['scanned']) return $step['kind'];
        }

        return null;
    }

    /**
     * TWO SLOTS, not a chain: the box and the location, fillable in either
     * order.
     *
     * An operator at a pack bench scans the box and carries it to the rack. An
     * operator with a trolley scans the rack once and feeds boxes into it.
     * Both are real, and the proof is the same either way — the pair has to
     * match the task. Refusing the second order only makes them fight the app.
     *
     * A scan that is waiting to be confirmed outranks any new scan, because
     * the confirm is the operator reading back what the screen claims they
     * just scanned.
     */
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

        // Name the deepest level still owed, but any level above it is
        // accepted too — the operator may be walking in from the aisle.
        $next = $this->nextLocationLevel();

        return $next === 'shelf' && ($this->zone_scan_at || $this->rack_scan_at)
            ? 'Now scan the shelf'
            : 'Scan the ' . ($next ?: 'location');
    }

    /** The scan types still outstanding — what the floor may present next. */
    public function expectedScans(): array
    {
        return array_values(array_filter([
            $this->box_scan_at ? null : 'box',
            $this->shelf_scan_at ? null : $this->locationSlot(),
        ]));
    }

    /**
     * Both slots scanned. The Complete press is the operator's single
     * acknowledgement — it stamps both confirmed_at columns, so the record
     * still distinguishes "a barcode was read" from "a person agreed", it
     * just asks for that agreement once instead of twice.
     */
    public function readyToComplete(): bool
    {
        return $this->box_scan_at !== null && $this->shelf_scan_at !== null;
    }

    /**
     * Back to the start after three refusals in a row.
     *
     * Not a failure of the task — the box still has to go somewhere. Three bad
     * reads in a row almost always means the operator is standing at the wrong
     * rack, and the cheapest fix is to make them scan the box again rather
     * than let them keep guessing at a location.
     */
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

    /** Kept for the older hand-scan chain, which still walks box → … → shelf. */
    public function nextScan(): ?string
    {
        if ($this->box_scan_at === null)   return 'box';
        if ($this->shelf_scan_at === null) return $this->locationSlot();

        return null;
    }
}
