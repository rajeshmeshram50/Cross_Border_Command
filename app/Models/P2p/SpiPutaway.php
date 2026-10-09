<?php

namespace App\Models\P2p;

use App\Models\Branch;
use App\Models\Client;
use App\Models\Masters\WarehouseMaster;
use App\Models\Concerns\BelongsToTenant;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * Stage 04 · where a box rests before final binning. One row per box.
 *
 * The four scan timestamps are the chain the operator must follow:
 * box -> location -> rack -> shelf. Until confirmed_at is set the box is
 * PICKED BUT NOT PLACED — that distinction is what the Digital Warehouse reads.
 *
 * A third-party warehouse allocates no rack or shelf, so those stay NULL. The
 * own / 3PL split is read from master_warehouse_master.wh_type, never stored
 * here: a stored copy could contradict the warehouse it points at.
 */
class SpiPutaway extends Model
{
    use BelongsToTenant, SoftDeletes;

    protected $table = 'p2p_spi_putaways';

    public const SCAN_TYPES = ['box', 'location', 'rack', 'shelf'];
    public const CONDITIONS = ['perfect', 'minor', 'major', 'severe'];

    protected $fillable = [
        'client_id', 'branch_id', 'supplier_invoice_id', 'box_id',
        'warehouse_id', 'zone_id', 'rack_id', 'shelf_id', 'destination',
        'box_scanned_at', 'location_scanned_at', 'rack_scanned_at', 'shelf_scanned_at',
        'device_id', 'device_serial', 'scanned_by',
        'confirmed_at', 'confirmed_by', 'condition_at_putaway',
    ];

    protected $casts = [
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
    public function warehouse(): BelongsTo   { return $this->belongsTo(WarehouseMaster::class, 'warehouse_id'); }
    public function scannedBy(): BelongsTo   { return $this->belongsTo(User::class, 'scanned_by'); }
    public function confirmedBy(): BelongsTo { return $this->belongsTo(User::class, 'confirmed_by'); }

    /** Scanned onto a shelf but not yet signed off — picked, not placed. */
    public function isPlaced(): bool
    {
        return $this->confirmed_at !== null;
    }

    /**
     * The next scan the operator owes, or null when the chain is complete.
     * On a third-party warehouse the chain ends at the location.
     */
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
}
