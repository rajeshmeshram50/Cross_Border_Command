<?php

namespace App\Http\Controllers\Api\P2p;

use App\Http\Controllers\Controller;
use App\Models\Inventory\LocationLock;
use App\Models\Inventory\LocationOccupancy;
use App\Models\Inventory\PutawayActivityLog;
use App\Models\P2p\SpiPutaway;
use App\Models\P2p\SpiPutawayTask;
use App\Models\P2p\SupplierInvoice;
use App\Services\Inventory\LocationLockService;
use App\Services\Inventory\LocationOccupancyService;
use App\Services\Inventory\PutawayActivityLogger;
use App\Services\P2p\SupplierInvoiceService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * P2P · Zebra verification tasks. /api/p2p/spi/{id}/putaway/... and /putaway/tasks
 *
 * Option 01 of Step 03. Where Manual Confirmation completes the put-away, this
 * hands the box to the warehouse floor and leaves it outstanding: the box is
 * placed only once a handheld scans the box QR and then the shelf QR.
 *
 * Nothing about the capacity changes here. The shelf was reserved when the
 * location was assigned, and it stays reserved for as long as the task is open
 * — including after the task is CANCELLED, because the screen goes straight
 * back to the same address offering manual confirmation, and letting go of the
 * shelf in between would hand it to somebody else mid-decision.
 */
class SpiPutawayTaskController extends Controller
{
    public function __construct(
        private LocationOccupancyService $occupancy,
        private LocationLockService $locks,
        private PutawayActivityLogger $activity,
        private SupplierInvoiceService $svc,
    ) {}

    /** A 404 that names what was not found, rather than a framework trace. */
    private function missing(string $message): never
    {
        abort(response()->json(['status' => false, 'message' => $message], 404));
    }

    private function tenantUser(Request $request)
    {
        $user = $request->user();
        if (!$user?->client_id) abort(response()->json(['status' => false, 'message' => 'No tenant context'], 403));

        return $user;
    }

    /* ══════════════════════════ CREATE ══════════════════════════ */

    /**
     * POST /p2p/spi/{id}/putaway/{row}/scan-task — Option 01.
     *
     * The tick is required and is not decoration: the dialog tells the operator
     * the shelf is locked for this box and cannot be changed, so the request
     * carries their acknowledgement of it.
     */
    public function store(Request $request, int $id, int $rowId)
    {
        $user = $this->tenantUser($request);
        $spi  = SupplierInvoice::find($id);
        if (!$spi) $this->missing("No supplier invoice found with id {$id}.");

        $row  = SpiPutaway::where('supplier_invoice_id', $id)->with('box:id,box_code')->find($rowId);
        if (!$row) $this->missing("No put-away found with id {$rowId} on {$spi->code}.");

        $request->validate([
            'confirmed'  => ['required', 'accepted'],
            'ttl_hours'  => ['nullable', 'integer', 'min:1', 'max:72'],
        ]);

        if ($row->isPlaced())  abort($this->reject('That box is already placed.'));
        if (!$row->zone_id)    abort($this->reject('Assign a location before sending it for verification.'));

        if (SpiPutawayTask::where('putaway_id', $row->id)->open()->exists()) {
            abort($this->reject('A task is already open for this box.'));
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

            $ttl  = (int) ($request->input('ttl_hours') ?: SpiPutawayTask::DEFAULT_TTL_HOURS);
            $task = SpiPutawayTask::create([
                'client_id'             => $row->client_id,
                'branch_id'             => $row->branch_id,
                'supplier_invoice_id'   => $spi->id,
                'putaway_id'            => $row->id,
                'box_id'                => $row->box_id,
                'occupancy_id'          => $occ->id,
                'task_code'             => $this->allocateCode((int) $row->client_id, $row->branch_id),
                'warehouse_id'          => $row->warehouse_id,
                'zone_id'               => $row->zone_id,
                'rack_id'               => $row->rack_id,
                'shelf_id'              => $row->shelf_id,
                // Box QR, then the shelf — or the zone, where there is no shelf.
                'required_scans'        => 2,
                'completed_scans'       => 0,
                'status'                => SpiPutawayTask::PENDING,
                'capacity_reserved_pct' => $this->reservedPct($occ),
                'issued_at'             => now(),
                'issued_by'             => $user->id,
                'expires_at'            => now()->addHours($ttl),
                'created_by'            => $user->id,
                'updated_by'            => $user->id,
            ]);

            $row->forceFill([
                'task_id' => $task->id,
                'status'  => SpiPutaway::AWAITING_SCAN,
            ])->save();

            /* The lock outlives the screen now. A handheld may take hours, so
               the hold follows the task's deadline rather than the 30 idle
               minutes a browser gets. */
            if ($lock = $this->locks->held($occ->locationType(), $occ->locationId())) {
                $lock->forceFill([
                    'held_for_type' => 'putaway_task',
                    'held_for_id'   => $task->id,
                    'expires_at'    => $task->expires_at,
                ])->save();
            }

            $this->activity->log(
                PutawayActivityLog::TASK_CREATED, 'task', (int) $task->id,
                (int) $row->client_id, $row->branch_id, $user->id,
                [
                    'occupancy_id' => $occ->id, 'putaway_id' => $row->id,
                    'task_id'      => $task->id, 'box_id' => $row->box_id,
                    'to_location'  => $this->activity->snapshot($row->warehouse_id, $row->zone_id, $row->rack_id, $row->shelf_id),
                    'meta'         => ['task_code' => $task->task_code, 'expires_at' => $task->expires_at?->toDateTimeString()],
                ],
            );

            $this->svc->log($spi, 'putaway_scan_task_created', [
                'box_id' => $row->box_id, 'new_value' => $task->task_code, 'stage' => 4,
            ]);

            DB::commit();

            return response()->json(['status' => true, 'data' => $this->body($task->refresh(), $row)], 201);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    /* ══════════════════════════ READ ══════════════════════════ */

    /** GET /p2p/spi/{id}/putaway/tasks — this invoice's queue, with its counts. */
    public function index(Request $request, int $id)
    {
        try {
            DB::beginTransaction();

            $this->tenantUser($request);

            $tasks = SpiPutawayTask::where('supplier_invoice_id', $id)
                ->with(['box:id,box_code', 'putaway:id,destination'])
                ->orderByDesc('id')
                ->get();

            $body = [
                'counts' => [
                    'awaiting_scan' => $tasks->where('status', SpiPutawayTask::PENDING)->count(),
                    'placed'        => $tasks->where('status', SpiPutawayTask::SCANNED)->count(),
                    'cancelled'     => $tasks->where('status', SpiPutawayTask::CANCELLED)->count(),
                    'expired'       => $tasks->where('status', SpiPutawayTask::EXPIRED)->count(),
                ],
                'tasks'  => $tasks->map(fn (SpiPutawayTask $t) => $this->body($t, $t->putaway))->all(),
            ];

            DB::commit();

            return response()->json(['status' => true, 'data' => $body], 200);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    /** GET /putaway/tasks — the branch-wide floor queue, open ones first. */
    public function queue(Request $request)
    {
        try {
            DB::beginTransaction();

            $this->tenantUser($request);

            $tasks = SpiPutawayTask::with(['box:id,box_code', 'invoice:id,code'])
                ->when($request->filled('status'), fn ($q) => $q->where('status', $request->string('status')))
                ->orderByRaw("case when status = 'pending' then 0 else 1 end")
                ->orderByDesc('id')
                ->paginate((int) $request->input('per_page', 10));

            DB::commit();

            return response()->json(['status' => true, 'data' => $tasks], 200);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    /**
     * GET /putaway/tasks/{task} — one task, as it stands right now.
     *
     * Separate from /activity on purpose. This answers "where is this box up
     * to", which a screen may poll; that one answers "how did it get there"
     * and carries every scan ever made against the task. Dragging dozens of
     * log rows along to render a status chip is the wrong trade.
     */
    public function show(Request $request, int $taskId)
    {
        $user = $this->tenantUser($request);

        $task = SpiPutawayTask::where('client_id', $user->client_id)
            ->with(['box:id,box_code', 'putaway:id,destination', 'invoice:id,code'])
            ->find($taskId);

        if (!$task) $this->missing("No put-away task found with id {$taskId}.");

        return response()->json(['status' => true, 'data' => $this->body($task, $task->putaway) + [
            'spi_code'   => $task->invoice?->code,
            'step'       => $task->currentStep(),
            'step_label' => $task->stepLabel(),
            'ready_to_complete' => $task->readyToComplete(),
            'attempts_left'     => max(0, SpiPutawayTask::MAX_FAILS - (int) $task->fail_count),
            // What a status chip actually needs, already decided server-side.
            'is_open'    => $task->isOpen(),
            'is_done'    => $task->status === SpiPutawayTask::SCANNED,
        ]], 200);
    }

    /**
     * GET /putaway/tasks/{task}/activity — what happened, in order.
     *
     * The task row says WHERE it ended up; this says how it got there, and it
     * is the only place the REFUSALS survive. A put-away that took four
     * attempts and one wrong rack reads identically to a clean one on the task
     * row alone — the difference lives here, and it is the difference worth
     * reading when someone asks why a box took twenty minutes.
     *
     * Not on the handheld's device-authenticated routes: this is a back-office
     * read, and the floor has no use for it mid-scan.
     */
    public function activity(Request $request, int $taskId)
    {
        $user = $this->tenantUser($request);

        $task = SpiPutawayTask::where('client_id', $user->client_id)
            ->with(['box:id,box_code', 'invoice:id,code'])
            ->find($taskId);

        if (!$task) $this->missing("No put-away task found with id {$taskId}.");

        $rows = PutawayActivityLog::where('task_id', $task->id)
            ->orderBy('id')
            ->get()
            ->map(fn (PutawayActivityLog $l) => [
                'id'         => (int) $l->id,
                'at'         => optional($l->created_at)->toIso8601String(),
                'event'      => $l->event,
                'ok'         => $l->event !== PutawayActivityLog::SCAN_FAILED,
                'actor_type' => $l->actor_type,
                'actor_id'   => $l->actor_id ? (int) $l->actor_id : null,
                'actor'      => $l->actor_id ? DB::table('users')->where('id', $l->actor_id)->value('name') : null,
                'device_id'  => $l->device_id ? (int) $l->device_id : null,
                'meta'       => $l->meta,
                'to'         => $l->to_location,
            ]);

        return response()->json(['status' => true, 'data' => [
            'task' => [
                'id'                 => (int) $task->id,
                'task_code'          => $task->task_code,
                'status'             => $task->status,
                'box_code'           => $task->box?->box_code,
                'spi_code'           => $task->invoice?->code,
                'required_scans'     => (int) $task->required_scans,
                'completed_scans'    => (int) $task->completed_scans,
                'fail_count'         => (int) $task->fail_count,
                'issued_at'          => optional($task->issued_at)->toIso8601String(),
                'box_scan_at'        => optional($task->box_scan_at)->toIso8601String(),
                'shelf_scan_at'      => optional($task->shelf_scan_at)->toIso8601String(),
                'box_confirmed_at'   => optional($task->box_confirmed_at)->toIso8601String(),
                'shelf_confirmed_at' => optional($task->shelf_confirmed_at)->toIso8601String(),
                'completed_at'       => optional($task->completed_at)->toIso8601String(),
                'cancelled_at'       => optional($task->cancelled_at)->toIso8601String(),
                'device_serial'      => $task->device_serial,
            ],
            'timeline' => $rows,
            'counts'   => [
                'total'  => $rows->count(),
                'passed' => $rows->where('ok', true)->count(),
                'failed' => $rows->where('ok', false)->count(),
            ],
        ]], 200);
    }

    /* ══════════════════════════ CANCEL ══════════════════════════ */

    /**
     * POST /putaway/tasks/{task}/cancel
     *
     * Closes the task and nothing else. The occupancy stays reserved and the
     * location stays locked, because the screen reopens on the same shelf with
     * manual confirmation offered — releasing the space in between would let
     * another operator take it out from under this one.
     */
    public function cancel(Request $request, int $taskId)
    {
        $user = $this->tenantUser($request);
        $task = SpiPutawayTask::with('putaway')->find($taskId);
        if (!$task) $this->missing("No verification task found with id {$taskId}.");

        $data = $request->validate(['reason' => ['nullable', 'string', 'max:120']]);

        if (!$task->isOpen()) {
            abort($this->reject("That task is already {$task->status}."));
        }

        try {
            DB::beginTransaction();

            $task->forceFill([
                'status'        => SpiPutawayTask::CANCELLED,
                'cancelled_at'  => now(),
                'cancelled_by'  => $user->id,
                'failed_reason' => $data['reason'] ?? null,
                'updated_by'    => $user->id,
            ])->save();

            $row = $task->putaway;
            if ($row && !$row->isPlaced()) {
                // Back to a held-but-unconfirmed box: a draft, not a pending one.
                $row->forceFill(['status' => SpiPutaway::DRAFT, 'task_id' => null])->save();
            }

            /* The lock was following the task's deadline; hand it back to a
               screen's idle timeout now that a person has it again. */
            if ($row && ($lock = $this->locks->held($row->shelf_id ? LocationLock::SHELF : LocationLock::ZONE,
                (int) ($row->shelf_id ?: $row->zone_id)))) {
                $this->locks->heartbeat($lock);
                $lock->forceFill(['held_for_type' => 'putaway', 'held_for_id' => $row->id])->save();
            }

            $this->activity->log(
                PutawayActivityLog::TASK_CANCELLED, 'task', (int) $task->id,
                (int) $task->client_id, $task->branch_id, $user->id,
                [
                    'occupancy_id' => $task->occupancy_id, 'putaway_id' => $task->putaway_id,
                    'task_id'      => $task->id, 'box_id' => $task->box_id,
                    'meta'         => ['task_code' => $task->task_code, 'reason' => $data['reason'] ?? null],
                ],
            );

            DB::commit();

            return response()->json(['status' => true, 'data' => $this->body($task->refresh(), $row)], 200);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    /* ══════════════════════════ HELPERS ══════════════════════════ */

    /**
     * ZT-YYYYMMDD-NNN, numbered per branch per day.
     *
     * Allocated under a lock on the branch row, the same way PO, SPI and the
     * inventory codes are: two tasks raised in the same second must not read
     * the same number, and a code a person quotes over a radio cannot be the
     * row id.
     */
    private function allocateCode(int $clientId, ?int $branchId): string
    {
        if ($branchId) {
            DB::table('branches')->where('id', $branchId)->lockForUpdate()->first();
        }

        $prefix = 'ZT-' . now()->format('Ymd') . '-';

        $last = SpiPutawayTask::withoutGlobalScopes()
            ->where('client_id', $clientId)
            ->when($branchId === null, fn ($q) => $q->whereNull('branch_id'), fn ($q) => $q->where('branch_id', $branchId))
            ->where('task_code', 'like', $prefix . '%')
            ->orderByDesc('task_code')
            ->value('task_code');

        $next = $last ? ((int) substr($last, -3)) + 1 : 1;

        return $prefix . str_pad((string) $next, 3, '0', STR_PAD_LEFT);
    }

    /** What the modal prints: "CAPACITY RESERVED 12.9% of SH-105". */
    private function reservedPct(LocationOccupancy $occ): ?float
    {
        if (!$occ->shelf_id) return null;

        $cap = (float) DB::table('inventory_shelves')->where('id', $occ->shelf_id)->value('max_weight_kg');

        return $cap > 0 ? round((float) $occ->weight_kg / $cap * 100, 2) : null;
    }

    private function body(SpiPutawayTask $task, ?SpiPutaway $row): array
    {
        return $task->toArray() + [
            'box_code'    => $task->box?->box_code,
            'putaway_code' => $task->box?->box_code ? 'PUT-' . $task->box->box_code : null,
            'destination' => $row?->destination,
            'next_scan'   => $task->nextScan(),
            'scans'       => ['done' => (int) $task->completed_scans, 'required' => (int) $task->required_scans],
        ];
    }

    private function reject(string $message)
    {
        return response()->json(['status' => false, 'message' => $message], 422);
    }
}
