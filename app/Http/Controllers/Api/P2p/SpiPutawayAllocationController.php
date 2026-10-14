<?php

namespace App\Http\Controllers\Api\P2p;

use App\Http\Controllers\Controller;
use App\Models\Inventory\LocationLock;
use App\Models\Inventory\LocationOccupancy;
use App\Models\Inventory\PutawayActivityLog;
use App\Models\P2p\SpiBox;
use App\Models\P2p\SpiPutaway;
use App\Models\P2p\SpiPutawayTask;
use App\Models\P2p\SupplierInvoice;
use App\Services\Inventory\LocationFinderService;
use App\Services\Inventory\LocationLockService;
use App\Services\Inventory\LocationOccupancyService;
use App\Services\Inventory\PutawayActivityLogger;
use App\Services\P2p\SupplierInvoiceService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * P2P · SPI Stage 04 steps 02 and 03 — choose a location, then hold it.
 *
 * Separate from SpiPutawayController, which owns the hand-scan chain. This one
 * owns the allocation: where may this box go, which place did the operator
 * take, and how was the placement attested.
 *
 * THE ORDER OF THE WRITES IS THE DESIGN. Assigning a location reserves its
 * capacity and locks it, before anything is confirmed, because a Zebra task can
 * sit open for hours and the shelf must not read as free meanwhile. Confirming
 * then changes only who says the box is there — never how full the shelf is.
 */
class SpiPutawayAllocationController extends Controller
{
    public function __construct(
        private LocationFinderService $finder,
        private LocationOccupancyService $occupancy,
        private LocationLockService $locks,
        private PutawayActivityLogger $activity,
        private SupplierInvoiceService $svc,
    ) {}

    private function tenantUser(Request $request)
    {
        $user = $request->user();
        if (!$user?->client_id) abort(response()->json(['status' => false, 'message' => 'No tenant context'], 403));

        return $user;
    }

    private function findSpi(int $id): SupplierInvoice
    {
        return SupplierInvoice::findOrFail($id);
    }

    /* ══════════════════════════ STEP 02 — READ ══════════════════════════ */

    /**
     * GET /p2p/spi/{id}/putaway/locations?box_id&mode
     *
     * Without `mode`, only the two counts the opening modal asks for. With it,
     * the whole tree plus the recommendation — one call, because Section A and
     * Section B are the same ranked list read two ways.
     */
    public function locations(Request $request, int $id)
    {
        $user = $this->tenantUser($request);
        $spi  = $this->findSpi($id);

        $data = $request->validate([
            'box_id' => ['required', 'integer'],
            'mode'   => ['nullable', Rule::in(['rack', 'norack'])],
        ]);

        if (!$spi->warehouse_id) {
            abort(response()->json(['status' => false, 'message' => 'Choose a warehouse before allocating boxes.'], 422));
        }

        $box = SpiBox::where('supplier_invoice_id', $spi->id)->findOrFail($data['box_id']);

        return response()->json([
            'status' => true,
            'data'   => $this->finder->forBox($spi, $box, $data['mode'] ?? null, $user->id),
        ], 200);
    }

    /**
     * GET /p2p/spi/{id}/putaway/board — where every box of this invoice stands.
     *
     * Driven from the BOXES, not from the put-away rows: a box nobody has
     * touched has no put-away row at all, and it is exactly the box the
     * operator is looking for. Starting from the rows would list only the work
     * already begun and quietly hide everything still to do.
     *
     * Two queries whatever the box count — the rows, and the open tasks.
     */
    public function board(Request $request, int $id)
    {
        $this->tenantUser($request);
        $spi = $this->findSpi($id);

        $boxes = SpiBox::where('supplier_invoice_id', $spi->id)
            ->orderBy('box_code')
            ->get(['id', 'box_code', 'scenario', 'gross_weight_kg', 'condition']);

        $rows = SpiPutaway::where('supplier_invoice_id', $spi->id)->get()->keyBy('box_id');

        $openTasks = SpiPutawayTask::where('supplier_invoice_id', $spi->id)
            ->open()->get(['id', 'task_code', 'putaway_id', 'box_id', 'completed_scans', 'required_scans', 'expires_at'])
            ->keyBy('box_id');

        $out = $boxes->map(function (SpiBox $b) use ($rows, $openTasks) {
            $row  = $rows->get($b->id);
            $task = $openTasks->get($b->id);

            // No row at all is a box nobody has started: pending, step 01.
            $status = $row ? $row->stage4Status((bool) $task) : SpiPutaway::PENDING;

            return [
                'box_id'      => (int) $b->id,
                'box_code'    => $b->box_code,
                'scenario'    => $b->scenario,
                'condition'   => $b->condition,
                'weight_kg'   => (float) ($b->gross_weight_kg ?: 0),
                'putaway_id'  => $row?->id,
                'status'      => $status,
                'destination' => $row?->destination,
                'assigned_at' => optional($row?->assigned_at)->toDateTimeString(),
                'draft_since' => $row?->draftSince(),
                'task'        => $task ? [
                    'id' => $task->id, 'task_code' => $task->task_code,
                    'scans' => ['done' => (int) $task->completed_scans, 'required' => (int) $task->required_scans],
                    'expires_at' => optional($task->expires_at)->toDateTimeString(),
                ] : null,
            ] + SpiPutaway::stepFor($status);
        })->values();

        $by = fn (string $s) => $out->where('status', $s)->count();

        return response()->json(['status' => true, 'data' => [
            'counts' => [
                'total'         => $out->count(),
                'pending'       => $by(SpiPutaway::PENDING),
                'draft'         => $by(SpiPutaway::DRAFT),
                'awaiting_scan' => $by(SpiPutaway::AWAITING_SCAN),
                'placed'        => $by(SpiPutaway::PLACED),
                // What the progress bar reads: "0 / 7 PLACED".
                'remaining'     => $out->count() - $by(SpiPutaway::PLACED),
            ],
            'steps'  => collect(SpiPutaway::STEPS)->map(fn ($s, $k) => [
                'status' => $k, 'step' => $s[0], 'label' => $s[1], 'boxes' => $by($k),
            ])->values(),
            'boxes'  => $out->all(),
        ]], 200);
    }

    /* ══════════════════════════ STEP 02 — WRITE ══════════════════════════ */

    /**
     * POST /p2p/spi/{id}/putaway/assign
     *
     * The box now has a place. Six writes, one transaction: lock the location,
     * reserve its capacity, create or move the put-away row, resync the cached
     * counters, log it.
     *
     * Re-assigning the same box releases its previous hold first, so a box
     * never consumes two places at once — the partial unique index would refuse
     * it anyway, but a clear release reads better in the trail than a caught
     * constraint violation.
     */
    public function assign(Request $request, int $id)
    {
        $user = $this->tenantUser($request);
        $spi  = $this->findSpi($id);

        $data = $request->validate([
            'box_id'     => ['required', 'integer'],
            'mode'       => ['required', Rule::in(['rack', 'norack'])],
            'zone_id'    => ['required', 'integer'],
            'rack_id'    => ['nullable', 'integer'],
            'shelf_id'   => ['nullable', 'integer'],
            'suggested_shelf_id' => ['nullable', 'integer'],
            'session_id' => ['nullable', 'string', 'max:64'],
        ]);

        $box   = SpiBox::where('supplier_invoice_id', $spi->id)->findOrFail($data['box_id']);
        $place = $this->validatePlace($spi, $data);

        // A placed box is final. Re-allocating it is not a correction, it is a move.
        $existing = SpiPutaway::where('box_id', $box->id)->first();
        if ($existing?->isPlaced()) {
            abort(response()->json([
                'status'  => false,
                'message' => "{$box->box_code} is already placed at {$existing->destination}.",
            ], 422));
        }
        if ($existing && SpiPutawayTask::where('putaway_id', $existing->id)->open()->exists()) {
            abort(response()->json([
                'status'  => false,
                'message' => "{$box->box_code} is out for Zebra verification — cancel that task before moving it.",
            ], 422));
        }

        try {
            DB::beginTransaction();

            // Hold the master row so two operators cannot both pass the check below.
            $lockType = $place['shelf_id'] ? LocationLock::SHELF : LocationLock::ZONE;
            $lockId   = (int) ($place['shelf_id'] ?: $place['zone_id']);
            DB::table($place['shelf_id'] ? 'inventory_shelves' : 'inventory_zones')
                ->where('id', $lockId)->lockForUpdate()->first();

            [$lock, $heldBy] = $this->locks->acquireOrExtend(
                $lockType, $lockId, (int) $spi->warehouse_id, (int) $spi->client_id, $place['branch_id'],
                $user->id, $data['session_id'] ?? null, LocationLock::REASON_PUTAWAY,
            );

            if (!$lock) {
                DB::rollBack();
                $who = $heldBy?->heldBy?->name ?? 'another operator';

                return response()->json([
                    'status'  => false,
                    'message' => "That location is in use by {$who}. Pick another.",
                ], 409);
            }

            $before = null;
            if ($old = $this->occupancy->liveFor(LocationOccupancy::TYPE_SPI_BOX, (int) $box->id)) {
                $before = $this->activity->snapshot($old->warehouse_id, $old->zone_id, $old->rack_id, $old->shelf_id);
                $this->occupancy->release($old, 'reassigned', $user->id);
                $this->releaseLockFor($old, LocationLock::RELEASED_REASSIGNED, $user->id);
            }

            $occ = $this->occupancy->reserve(
                $place, LocationOccupancy::TYPE_SPI_BOX, (int) $box->id,
                (int) $spi->client_id, $place['branch_id'], $box->box_code,
                (float) ($box->gross_weight_kg ?: $box->weight_kg ?: 0),
                $this->volumeOf($box), $this->footprintOf($box), $user->id,
            );

            $row = SpiPutaway::firstOrNew(['box_id' => $box->id]);
            $row->fill([
                'client_id'           => $spi->client_id,
                'branch_id'           => $place['branch_id'],
                'supplier_invoice_id' => $spi->id,
                'box_id'              => $box->id,
                'warehouse_id'        => $place['warehouse_id'],
                'zone_id'             => $place['zone_id'],
                'rack_id'             => $place['rack_id'],
                'shelf_id'            => $place['shelf_id'],
            ])->save();

            $row->forceFill([
                'occupancy_id'       => $occ->id,
                'suggested_shelf_id' => $data['suggested_shelf_id'] ?? $row->suggested_shelf_id,
                'destination'        => $this->describe($place),
                /* Held but unconfirmed. If the operator never comes back this
                   is what the box stays as, and what a worklist looks for. */
                'status'             => SpiPutaway::DRAFT,
                'assigned_at'        => now(),
                'assigned_by'        => $user->id,
            ])->save();

            $lock->forceFill(['held_for_type' => 'putaway', 'held_for_id' => $row->id])->save();

            $this->activity->log(
                $before ? PutawayActivityLog::REASSIGNED : PutawayActivityLog::ASSIGNED,
                'putaway', (int) $row->id, (int) $spi->client_id, $place['branch_id'], $user->id,
                [
                    'occupancy_id'  => $occ->id,
                    'putaway_id'    => $row->id,
                    'box_id'        => $box->id,
                    'from_location' => $before,
                    'to_location'   => $this->activity->snapshot(
                        $place['warehouse_id'], $place['zone_id'], $place['rack_id'], $place['shelf_id']
                    ),
                    'meta'          => ['mode' => $data['mode'], 'weight_kg' => (float) ($box->gross_weight_kg ?: 0)],
                ],
            );

            $this->svc->log($spi, 'putaway_assigned', [
                'box_id' => $box->id, 'new_value' => $row->destination, 'stage' => 4,
            ]);

            DB::commit();

            return response()->json(['status' => true, 'data' => $this->rowBody($row->refresh(), $box, $occ, $lock)], 200);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    /* ══════════════════════════ STEP 03 ══════════════════════════ */

    /**
     * POST /p2p/spi/{id}/putaway/{row}/confirm-manual — Option 02.
     *
     * The counters do not move here. The space was taken when the location was
     * assigned; what changes now is who attests that the box is on it. Recorded
     * as such, because a manual confirmation is somebody's word while a Zebra
     * scan is evidence, and an audit that cannot tell them apart cannot weigh
     * either.
     */
    public function confirmManual(Request $request, int $id, int $rowId)
    {
        $user = $this->tenantUser($request);
        $spi  = $this->findSpi($id);
        $row  = SpiPutaway::where('supplier_invoice_id', $id)->with('box:id,box_code')->findOrFail($rowId);

        $data = $request->validate([
            'confirmed'            => ['required', 'accepted'],
            'condition_at_putaway' => ['nullable', Rule::in(SpiPutaway::CONDITIONS)],
            'note'                 => ['nullable', 'string'],
        ]);

        if ($row->isPlaced()) {
            abort(response()->json(['status' => false, 'message' => 'That box is already placed.'], 422));
        }
        if (!$row->zone_id) {
            abort(response()->json(['status' => false, 'message' => 'Assign a location before confirming.'], 422));
        }
        if (SpiPutawayTask::where('putaway_id', $row->id)->open()->exists()) {
            abort(response()->json([
                'status'  => false,
                'message' => 'A Zebra task is open for this box — cancel it before confirming by hand.',
            ], 422));
        }

        try {
            DB::beginTransaction();

            $occ = $this->occupancy->liveFor(LocationOccupancy::TYPE_SPI_BOX, (int) $row->box_id);
            if (!$occ) {
                DB::rollBack();

                return response()->json([
                    'status'  => false,
                    'message' => 'That location is no longer held for this box — assign it again.',
                ], 409);
            }

            $this->occupancy->occupy($occ, $user->id);

            $row->forceFill([
                'status'               => SpiPutaway::PLACED,
                'confirmed_at'         => now(),
                'confirmed_by'         => $user->id,
                'verify_method'        => 'manual',
                'condition_at_putaway' => $data['condition_at_putaway'] ?? null,
            ])->save();

            $this->releaseLockFor($occ, LocationLock::RELEASED_COMPLETED, $user->id);

            $this->activity->log(
                PutawayActivityLog::CONFIRMED_MANUAL, 'putaway', (int) $row->id,
                (int) $row->client_id, $row->branch_id, $user->id,
                [
                    'occupancy_id' => $occ->id, 'putaway_id' => $row->id, 'box_id' => $row->box_id,
                    'to_location'  => $this->activity->snapshot($row->warehouse_id, $row->zone_id, $row->rack_id, $row->shelf_id),
                    'meta'         => ['note' => $data['note'] ?? null],
                ],
            );

            $this->svc->log($spi, 'putaway_confirmed', [
                'box_id' => $row->box_id, 'new_value' => $row->destination,
                'note'   => $data['note'] ?? null, 'stage' => 4,
            ]);

            DB::commit();

            return response()->json(['status' => true, 'data' =>
                $this->rowBody($row->refresh(), $row->box, $occ->refresh(), null) + $this->progress($spi),
            ], 200);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    /* ══════════════════════════ HELPERS ══════════════════════════ */

    /**
     * The chosen place, proved to belong to this invoice.
     *
     * An id in a request body is not evidence of ownership — these columns have
     * no foreign key behind them, so every level is re-read and checked against
     * the one above it. The branch comes from the WAREHOUSE, never from the
     * caller's branch switcher: a warehouse is branch-owned, and filing a box
     * under the operator's branch instead of the building's would lose it from
     * the only list that looks for it.
     */
    private function validatePlace(SupplierInvoice $spi, array $data): array
    {
        $wh = DB::table('inventory_warehouses')
            ->where('id', $spi->warehouse_id)
            ->where('client_id', $spi->client_id)
            ->first();
        if (!$wh) abort(response()->json(['status' => false, 'message' => 'This invoice has no valid warehouse.'], 422));

        $zone = DB::table('inventory_zones')
            ->where('id', $data['zone_id'])->where('warehouse_id', $wh->id)->first();
        if (!$zone)                     abort($this->reject('That zone is not in this warehouse.'));
        if ((int) $zone->status !== 1)  abort($this->reject("{$zone->zone_name} is inactive."));
        if ($zone->rack_mode !== $data['mode']) {
            abort($this->reject("{$zone->zone_name} is a " . ($zone->rack_mode === 'rack' ? 'racked' : 'no-rack') . ' zone.'));
        }

        $rackId = $shelfId = null;

        if ($data['mode'] === 'rack') {
            if (empty($data['shelf_id'])) abort($this->reject('Choose a shelf in a racked zone.'));

            $shelf = DB::table('inventory_shelves')->where('id', $data['shelf_id'])->first();
            if (!$shelf)                    abort($this->reject('That shelf does not exist.'));
            if ((int) $shelf->status !== 1) abort($this->reject("{$shelf->shelf_name} is inactive."));

            $rack = DB::table('inventory_racks')->where('id', $shelf->rack_id)->first();
            if (!$rack || (int) $rack->zone_id !== (int) $zone->id) {
                abort($this->reject('That shelf is not on a rack in the zone you chose.'));
            }
            if ((int) $rack->status !== 1) abort($this->reject("{$rack->rack_name} is inactive."));
            if (!empty($data['rack_id']) && (int) $data['rack_id'] !== (int) $rack->id) {
                abort($this->reject('That shelf is not on the rack you named.'));
            }

            $rackId  = (int) $rack->id;
            $shelfId = (int) $shelf->id;
        }

        return [
            'warehouse_id' => (int) $wh->id,
            'zone_id'      => (int) $zone->id,
            'rack_id'      => $rackId,
            'shelf_id'     => $shelfId,
            // The building's branch, not the operator's.
            'branch_id'    => $wh->branch_id !== null ? (int) $wh->branch_id : $spi->branch_id,
        ];
    }

    private function reject(string $message)
    {
        return response()->json(['status' => false, 'message' => $message], 422);
    }

    /** The lock covering an occupancy row, released by the same hand. */
    private function releaseLockFor(LocationOccupancy $occ, string $reason, ?int $userId): void
    {
        $lock = $this->locks->held($occ->locationType(), $occ->locationId());
        if ($lock) $this->locks->release($lock, $reason, $userId);
    }

    private function describe(array $place): string
    {
        $wh   = DB::table('inventory_warehouses')->where('id', $place['warehouse_id'])->value('code');
        $zone = DB::table('inventory_zones')->where('id', $place['zone_id'])->value('code');
        $rack = $place['rack_id'] ? DB::table('inventory_racks')->where('id', $place['rack_id'])->value('code') : null;

        $shelf = null;
        if ($place['shelf_id']) {
            $level = DB::table('inventory_shelves')->where('id', $place['shelf_id'])->value('level_no');
            $shelf = $level === null ? null : ($rack ?: 'RC-???') . '-SH-' . str_pad((string) $level, 2, '0', STR_PAD_LEFT);
        }

        return implode(' / ', array_filter([$wh, $zone, $rack, $shelf]));
    }

    private function volumeOf(SpiBox $box): ?float
    {
        $v = (float) ($box->length_cm ?: 0) * (float) ($box->width_cm ?: 0) * (float) ($box->height_cm ?: 0);

        return $v > 0 ? $v : null;
    }

    private function footprintOf(SpiBox $box): ?float
    {
        $f = (float) ($box->length_cm ?: 0) * (float) ($box->width_cm ?: 0);

        return $f > 0 ? $f : null;
    }

    private function rowBody(SpiPutaway $row, ?SpiBox $box, ?LocationOccupancy $occ, ?LocationLock $lock): array
    {
        $openTask = SpiPutawayTask::where('putaway_id', $row->id)->open()->first();

        return $row->toArray() + [
            'box_code'    => $box?->box_code,
            // Derived, never stored: see SpiPutaway::stage4Status().
            'status'      => $row->stage4Status((bool) $openTask),
            'draft_since' => $row->draftSince(),
            'occupancy'   => $occ ? [
                'id' => $occ->id, 'status' => $occ->status, 'weight_kg' => (float) $occ->weight_kg,
            ] : null,
            'lock'        => $lock ? [
                'id' => $lock->id, 'expires_at' => optional($lock->expires_at)->toDateTimeString(),
            ] : null,
            'task'        => $openTask ? [
                'id' => $openTask->id, 'task_code' => $openTask->task_code,
                'completed_scans' => $openTask->completed_scans, 'required_scans' => $openTask->required_scans,
            ] : null,
        ];
    }

    private function progress(SupplierInvoice $spi): array
    {
        $total  = SpiBox::where('supplier_invoice_id', $spi->id)->count();
        $placed = SpiPutaway::where('supplier_invoice_id', $spi->id)->whereNotNull('confirmed_at')->count();

        return ['spi_putaway_progress' => ['placed' => $placed, 'total' => $total, 'complete' => $placed >= $total]];
    }
}
