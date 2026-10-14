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
        'status', 'capacity_reserved_pct',
        'issued_at', 'issued_by', 'device_id', 'device_serial',
        'completed_at', 'cancelled_at', 'cancelled_by', 'failed_reason', 'expires_at',
        'created_by', 'updated_by',
    ];

    protected $casts = [
        'box_scan_at'           => 'datetime',
        'shelf_scan_at'         => 'datetime',
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

    /**
     * The next scan the handheld owes, or null when the chain is done.
     *
     * The box first, always. Scanning the shelf first would prove only that
     * somebody stood in front of a shelf — not that the box was in their hand.
     */
    public function nextScan(): ?string
    {
        if ($this->box_scan_at === null)   return 'box';
        if ($this->shelf_scan_at === null) return $this->shelf_id ? 'shelf' : 'zone';

        return null;
    }
}
