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

/**
 * Stage 04 · where a box rests before final binning. One row per box.
 *
 * The four scan timestamps are the chain the operator must follow:
 * box -> location -> rack -> shelf. Until confirmed_at is set the box is
 * PICKED BUT NOT PLACED — that distinction is what the Digital Warehouse reads.
 *
 * A third-party warehouse allocates no rack or shelf, so those stay NULL. The
 * own / 3PL split is read from inventory_warehouses.wh_type, never stored
 * here: a stored copy could contradict the warehouse it points at.
 */
class SpiPutaway extends Model
{
    use BelongsToTenant, SoftDeletes;

    protected $table = 'p2p_spi_putaways';

    public const SCAN_TYPES = ['box', 'location', 'rack', 'shelf'];
    public const CONDITIONS = ['perfect', 'minor', 'major', 'severe'];

    /** Started and left: a location is held, nothing has confirmed it. */
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
    // The Inventory master, like SupplierInvoice::warehouse() — the ids in
    // this table were allocated from inventory_warehouses, not the old
    // master_warehouse_master the SPI was first written against.
    public function warehouse(): BelongsTo   { return $this->belongsTo(Warehouse::class, 'warehouse_id'); }
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

    /**
     * Stage 04's four states, DERIVED — there is no status column on purpose.
     *
     * A stored status is a second answer to a question the timestamps already
     * answer, and the two drift: a crash between writing confirmed_at and
     * writing status leaves a box that is placed and says it is not. These
     * cannot disagree, because there is only one of them.
     *
     *   pending        nobody has started — no row, or a row with no location
     *   draft          a location is held but nothing has confirmed it. Someone
     *                  began and walked away; the shelf is still reserved for
     *                  this box and no one else is offered it
     *   awaiting_scan  a Zebra task is open; the floor has it
     *   placed         confirmed, by a person or by a device. Final
     */
    public function stage4Status(bool $hasOpenTask = false): string
    {
        if ($this->confirmed_at) return 'placed';
        if ($hasOpenTask)        return 'awaiting_scan';
        if ($this->shelf_id || $this->zone_id) return 'draft';

        return 'pending';
    }

    /** When the draft was last touched — how long it has been sitting. */
    public function draftSince(): ?string
    {
        return $this->confirmed_at ? null : optional($this->updated_at)->toDateTimeString();
    }

    /**
     * Which of Stage 04's four sub-steps this box is sitting on.
     *
     * Derived from the status, not stored, because the mapping is exact for
     * every state that lasts. Step 02 is the one step that is not a resting
     * place: choosing a location either assigns it — and the box moves to
     * step 03 — or it does not, and nothing was held, nothing reserved,
     * nothing locked. A column for it could only ever record somebody looking.
     */
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
