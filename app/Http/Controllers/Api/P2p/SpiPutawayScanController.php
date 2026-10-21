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
use App\Models\ScanDevice;
use App\Models\User;
use App\Services\Inventory\LocationLockService;
use App\Services\Inventory\LocationOccupancyService;
use App\Services\Inventory\PutawayActivityLogger;
use App\Services\Inventory\StickerKey;
use App\Services\P2p\SupplierInvoiceService;
use App\Support\TenantContext;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * Stage 04 · the handheld that closes a put-away task.
 *
 * AUTHENTICATED BY DEVICE, NOT BY SESSION. The floor does not log in for every
 * carton. A handheld proves itself with the credential installed when somebody
 * logged in to enroll it, and that person authors everything it confirms —
 * scan_devices.enrolled_by. So the tenant is read off the DEVICE row, never
 * off the request, and a credential for another client simply cannot see this
 * client's boxes.
 *
 * TWO SLOTS, EITHER ORDER. The box and the location can arrive in either
 * sequence, because both are real ways to work: box-at-the-bench-then-walk,
 * or scan-the-rack-then-feed-boxes-into-it. What is being proved is that the
 * PAIR matches the task, and a pair does not care which half arrived first.
 *
 * SCAN AND CONFIRM ARE SEPARATE. A scan is a barcode passing a lens; the
 * confirm is a person reading the screen and agreeing. Both are recorded,
 * because only the second one is evidence that somebody looked.
 *
 * NOTHING REACHES THE MAIN TABLES UNTIL complete(). Scans and confirms write
 * only to the task and to the activity log. The occupancy flip, the put-away
 * row and the shelf counters all happen in one transaction at the end, so an
 * abandoned task leaves no half-placed box behind.
 */
class SpiPutawayScanController extends Controller
{
    public function __construct(
        private LocationOccupancyService $occupancy,
        private LocationLockService $locks,
        private PutawayActivityLogger $activity,
        private SupplierInvoiceService $svc,
    ) {}

    /* ════════════════════════════ ENDPOINTS ════════════════════════════ */

    /**
     * POST /scan/putaway/session — who is this handheld, and what is open.
     *
     * The first call the page makes. A device that is not enrolled, suspended
     * or retired is told so here rather than halfway through a put-away.
     */
    public function session(Request $request)
    {
        $device = $this->device($request);

        $tasks = SpiPutawayTask::where('client_id', $device->client_id)
            ->open()
            ->with(['box:id,box_code', 'invoice:id,code'])
            ->orderBy('issued_at')
            ->limit(50)
            ->get()
            ->map(fn (SpiPutawayTask $t) => [
                'id'          => (int) $t->id,
                'task_code'   => $t->task_code,
                'box_code'    => $t->box?->box_code,
                'spi_code'    => $t->invoice?->code,
                'step'        => $t->currentStep(),
                'step_label'  => $t->stepLabel(),
                'destination' => $this->describe($t),
            ]);

        return response()->json(['status' => true, 'data' => [
            'device' => $this->deviceBody($device),
            'open'   => $tasks,
            'count'  => $tasks->count(),
        ]], 200);
    }

    /** GET /scan/putaway/{task} — the current state, for a page refresh. */
    public function show(Request $request, int $taskId)
    {
        $device = $this->device($request);
        // Read-only, so a finished task may be looked at. Only the calls that
        // WRITE require it to still be open.
        $task   = $this->findTask($device, $taskId, false);

        /* Reopened after sitting idle: hand back a clean task rather than a
           half-walked one the next scan would throw away anyway. Doing it
           here means a refresh and a fresh scan agree about what is owed. */
        $stale = $task->isOpen() ? $this->dropStaleScans($task, $device) : false;

        $body = ['status' => true, 'data' => $this->state($task, $device)];
        if ($stale) {
            $body['stale_reset'] = true;
            $body['notice']      = 'That put-away was left too long — scan the box again to restart it.';
        }

        return response()->json($body, 200);
    }

    /**
     * POST /scan/putaway/scan — a barcode arrived.
     *
     * The server decides what it was and whether it belongs here; the handheld
     * is never trusted to know which step it is on. Every outcome writes an
     * activity row, pass or fail — a refusal is the one thing the log exists
     * to remember.
     */
    public function scan(Request $request)
    {
        $device = $this->device($request);

        $data = $request->validate([
            'scanned_value'   => ['required', 'string', 'max:255'],
            'task_id'         => ['nullable', 'integer'],
            // A location scanned BEFORE any box: the page holds it and hands it
            // back with the box scan. Re-proved here — it is a client value.
            'staged_location' => ['nullable', 'integer'],
            'staged_kind'     => ['nullable', Rule::in(['shelf', 'zone', 'rack'])],
        ]);

        $hit = $this->classify($data['scanned_value']);

        /* A task id the handheld is still carrying. Looked up LENIENTLY and
           dropped if it has since closed: the page keeps the id in storage so
           a camera scan survives the page reload, and that outlives the task.
           Failing the scan because of it would mean one finished put-away
           blocks every later one until storage is cleared by hand. The box
           scan finds the right open task on its own. */
        $task = isset($data['task_id']) ? $this->findTask($device, (int) $data['task_id'], false) : null;
        if ($task && !$task->isOpen()) $task = null;

        // Half-scanned and abandoned: start that one clean before going on.
        $stale = $task ? $this->dropStaleScans($task, $device) : false;

        // A signed sticker whose signature does not check out is refused before
        // anything is looked up — the id inside it is not evidence of anything.
        if ($hit['signed'] && !$hit['valid']) {
            return $this->refuse($task, $device, 'bad_signature',
                'That label did not pass its signature check. Use the printed label.', $data);
        }

        if (!$hit['kind']) {
            return $this->refuse($task, $device, 'unreadable',
                'That is not a Cross Border label.', $data);
        }

        $res = $hit['kind'] === 'box'
            ? $this->scanBox($device, $task, $hit, $data)
            : $this->scanLocation($device, $task, $hit, $data);

        /* The scan that closes the pair finishes the put-away.
           Both halves had to match this task to be accepted, so by the time
           both are in, the barcodes have already proved everything a button
           press could. Asking for one more tap only leaves a placed box
           sitting un-placed in the system while the operator walks away. */
        $body = $res->getData(true);
        $done = $body['data']['task']['id'] ?? null;

        if (($body['status'] ?? false) && $done) {
            $fresh = SpiPutawayTask::find($done);

            if ($fresh?->isOpen() && $fresh->readyToComplete()) {
                return $this->commit($fresh, $device);
            }
        }

        /* Say the old run was dropped. Silently restarting is worse than not
           restarting: the operator scans a shelf, is told to scan the box,
           and has no idea the screen threw away what they did earlier. */
        if ($stale) {
            $body = $res->getData(true);
            $body['stale_reset'] = true;
            $body['notice'] = 'The earlier scan timed out — starting this box again.';
            $res->setData($body);
        }

        return $res;
    }

    /**
     * POST /scan/putaway/{task}/confirm — the operator read the screen back.
     *
     * Confirms whichever slot is scanned but unconfirmed. It writes no
     * placement; it only records that a person agreed with what was shown.
     */
    public function confirm(Request $request, int $taskId)
    {
        $device = $this->device($request);
        $task   = $this->findTask($device, $taskId);

        $data = $request->validate([
            'slot' => ['required', Rule::in(['box', 'shelf', 'zone'])],
        ]);

        $slot = $data['slot'] === 'box' ? 'box' : 'shelf';   // one column pair for either location kind
        $col  = $slot . '_confirmed_at';

        if (!$task->{$slot . '_scan_at'}) {
            return $this->reject("Scan the {$data['slot']} before confirming it.", $task, $device);
        }
        if ($task->{$col}) {
            return $this->reject(ucfirst($data['slot']) . ' is already confirmed.', $task, $device);
        }

        $task->forceFill([$col => now(), 'updated_by' => $device->actorId()])->save();

        $this->log($task, $device, PutawayActivityLog::SCAN_PASSED, [
            'meta' => ['act' => 'confirm', 'slot' => $data['slot']],
        ]);

        return response()->json(['status' => true, 'data' => $this->state($task->refresh(), $device)], 200);
    }

    /**
     * POST /scan/putaway/{task}/complete — the only call that moves stock.
     *
     * Everything before this was evidence-gathering. Here the reservation
     * becomes an occupation, the put-away row is marked placed, the shelf lock
     * is given back and the task is closed — one transaction, so a box is
     * never half-placed.
     */
    public function complete(Request $request, int $taskId)
    {
        $device = $this->device($request);
        $task   = $this->findTask($device, $taskId);

        if (!$task->readyToComplete()) {
            return $this->reject('Scan both the box and the location first.', $task, $device);
        }

        return $this->commit($task, $device);
    }

    /**
     * Place the box. Called by the Complete button, and by the scan that
     * finishes the pair on its own.
     *
     * The scans ARE the proof: both halves had to match this task to get
     * here, and a button press adds no verification the barcodes have not
     * already given. So the pair closing is enough to move the stock.
     */
    private function commit(SpiPutawayTask $task, ScanDevice $device)
    {
        $actor = $device->actorId();

        /* Both slots acknowledged. Stamped before the transaction so the
           columns still record agreement separately from when each barcode
           was read — whether that came from the Complete button or from the
           scan that closed the pair. */
        $task->forceFill([
            'box_confirmed_at'   => $task->box_confirmed_at ?: now(),
            'shelf_confirmed_at' => $task->shelf_confirmed_at ?: now(),
        ])->save();

        $row = SpiPutaway::find($task->putaway_id);
        if (!$row)            return $this->reject('The put-away row for this task is gone.', $task, $device);
        if ($row->isPlaced()) return $this->reject('That box is already placed.', $task, $device);

        try {
            DB::beginTransaction();

            $occ = $this->occupancy->liveFor(LocationOccupancy::TYPE_SPI_BOX, (int) $row->box_id);
            if (!$occ) {
                DB::rollBack();

                return response()->json([
                    'status'  => false,
                    'message' => 'That location is no longer held for this box — it must be assigned again.',
                ], 409);
            }

            $this->occupancy->occupy($occ, $actor);

            $row->forceFill([
                'status'        => SpiPutaway::PLACED,
                'confirmed_at'  => now(),
                'confirmed_by'  => $actor,
                'verify_method' => 'scan',
            ])->save();

            $this->releaseLockFor($occ, $actor);

            $task->forceFill([
                'status'          => SpiPutawayTask::SCANNED,
                'completed_at'    => now(),
                'completed_scans' => $task->required_scans,
                'updated_by'      => $actor,
            ])->save();

            $this->activity->log(
                PutawayActivityLog::CONFIRMED_DEVICE, 'putaway', (int) $row->id,
                (int) $task->client_id, $task->branch_id, $actor,
                [
                    'occupancy_id' => $occ->id,
                    'putaway_id'   => $row->id,
                    'task_id'      => $task->id,
                    'box_id'       => $row->box_id,
                    'device_id'    => $device->id,
                    'to_location'  => $this->activity->snapshot($row->warehouse_id, $row->zone_id, $row->rack_id, $row->shelf_id),
                    'meta'         => ['device_serial' => $device->serial, 'task_code' => $task->task_code],
                ],
                'device',
            );

            if ($spi = $task->invoice) {
                $this->svc->log($spi, 'putaway_confirmed', [
                    'box_id' => $row->box_id, 'new_value' => $row->destination,
                    'note'   => 'Scanned on ' . $device->serial, 'stage' => 4,
                ]);
            }

            DB::commit();

            return response()->json([
                'status'  => true,
                'message' => 'Put-away complete.',
                'data'    => $this->state($task->refresh(), $device),
            ], 200);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    /* ═══════════════════════════ SCAN HANDLERS ═══════════════════════════ */

    /** The box half of the pair. */
    private function scanBox(ScanDevice $device, ?SpiPutawayTask $task, array $hit, array $data)
    {
        $box = SpiBox::where('client_id', $device->client_id)->find($hit['id']);
        if (!$box) {
            return $this->refuse($task, $device, 'unknown_box',
                'No box on this account matches that label.', $data);
        }

        /* THE INVOICE THIS CARTON WAS PACKED UNDER — resolved before anything
           else is looked up, and every lookup below is scoped to it.
           box_code is only unique WITHIN an invoice: each one starts again at
           B-001, so four different cartons on this floor answer to that name.
           A row joined on box_code alone, or a message that says "B-001", is
           talking about a carton nobody can identify. */
        $spi = $box->supplier_invoice_id
            ? SupplierInvoice::where('client_id', $device->client_id)->find($box->supplier_invoice_id)
            : null;

        /* Not packed under any invoice. The label exists and its signature is
           good, but nothing says which consignment the carton belongs to —
           there is no put-away to do and no way to name what they are holding. */
        if (!$spi) {
            return $this->refuse($task, $device, 'box_not_packed',
                "{$box->box_code} is not packed against any supplier invoice. It cannot be put away.", $data);
        }

        $open = SpiPutawayTask::where('box_id', $box->id)
            ->where('supplier_invoice_id', $spi->id)
            ->where('client_id', $device->client_id)
            ->open()->first();

        if (!$open) {
            /* Three different situations end up here and they need three
               different answers. "Allocate it first" told the operator to go
               and allocate a box that was already sitting on a shelf — true
               that no task is open, and the worst possible next instruction. */
            /* Scoped to the box's OWN invoice, and newest first. Unscoped,
               a box re-allocated under a later invoice could be judged by a
               row belonging to a different consignment — and `first()` with
               no order picks whichever the planner happens to return. */
            $row = SpiPutaway::where('box_id', $box->id)
                ->where('supplier_invoice_id', $spi->id)
                ->where('client_id', $device->client_id)
                ->latest('id')->first();

            /* Name where they are standing, when a location was scanned
               first. "No put-away initiated for B-001" is true but reads as a
               dead end; the operator is at a rack holding a carton and needs
               to know this box is not the one that belongs here. */
            $at = !empty($data['staged_location'])
                ? $this->nameLocation($data['staged_kind'] ?? 'shelf', (int) $data['staged_location'])
                : null;
            $here = $at ? " It does not belong at {$at}." : '';

            if ($row?->isPlaced()) {
                /* Not a mistake — the carton is where it should be. Say so,
                   with the proof, and leave the open task's attempts alone. */
                return $this->refuse($task, $device, 'already_placed',
                    "{$box->box_code} of {$spi->code} is already put away.", $data, [
                        'placed' => [
                            'box_code'    => $box->box_code,
                            'spi_code'    => $spi->code,
                            'destination' => $row->destination,
                            'at'          => optional($row->confirmed_at)->toIso8601String(),
                            'method'      => $row->verify_method,
                            'by'          => $row->confirmed_by
                                ? DB::table('users')->where('id', $row->confirmed_by)->value('name')
                                : null,
                        ],
                    ], false);
            }

            $named = "{$box->box_code} of {$spi->code}";

            return $this->refuse($task, $device, 'no_task',
                $row?->zone_id
                    ? "No scan task for {$named}. It is allocated to {$row->destination} — raise a task, or confirm it by hand."
                    // No instruction: allocating is a back-office action, and
                    // the person holding the box cannot do it from here.
                    : "No put-away initiated for {$named}.{$here}",
                $data);
        }

        /* Scanning a different box mid-task is a wrong turn, not a new task.
           Lead with the box this task actually wants: the operator is holding
           the wrong carton and needs to know which one to reach for. Naming
           two task codes and no box, as this did, describes the problem
           accurately and helps with nothing. */
        if ($task && (int) $task->id !== (int) $open->id) {
            $wants = $this->boxCode($task);

            return $this->refuse($task, $device, 'wrong_box',
                "Wrong box — this task wants {$wants}. {$box->box_code} of {$spi->code} belongs to {$open->task_code}.", $data);
        }

        $task = $open;

        /* A location scanned before any box. Now that the task is known, the
           pair can finally be judged — this is the reverse-order check. */
        if (!empty($data['staged_location'])) {
            $slot     = $task->locationSlot();
            $expected = (int) ($task->shelf_id ?: $task->zone_id);
            // Kind as well as id, for the same reason as a live location scan:
            // rack 1 and shelf 1 are different places with the same number.
            $kindOk   = ($data['staged_kind'] ?? $slot) === $slot;

            if (!$kindOk || (int) $data['staged_location'] !== $expected) {
                return $this->refuse($task, $device, 'wrong_location',
                    "{$box->box_code} of {$spi->code} is assigned to " . $this->describe($task)
                    . '. You are at ' . ($this->nameLocation($data['staged_kind'] ?? $slot, (int) $data['staged_location']) ?: 'a different location') . '.', $data);
            }

            // Right place, reached the other way round: fill both slots.
            $task->forceFill([
                'shelf_scan_at'      => $task->shelf_scan_at ?: now(),
                'shelf_confirmed_at' => $task->shelf_confirmed_at ?: now(),
            ])->save();
        }

        $task->forceFill([
            'box_scan_at'   => now(),
            'device_id'     => $device->id,
            'device_serial' => $device->serial,
            'fail_count'    => 0,
            'updated_by'    => $device->actorId(),
        ])->save();

        $this->log($task, $device, PutawayActivityLog::SCAN_PASSED, [
            'box_id' => $box->id,
            'meta'   => ['act' => 'scan', 'slot' => 'box', 'value' => $data['scanned_value']],
        ]);

        /* Say which box this now is.
           A location scanned first carries no task, so any box due there is
           legitimately picked up — that is the trolley-at-the-rack flow. But
           the operator may have reached for the wrong carton, and a screen
           that answers "accepted" tells them nothing about WHICH put-away
           they are now on. Naming it is what lets them catch it before
           pressing Complete. */
        return response()->json([
            'status' => true,
            'notice' => "{$box->box_code} · {$task->task_code}",
            'data'   => $this->state($task->refresh(), $device),
        ], 200);
    }

    /** The location half — a shelf, or the zone in a rackless warehouse. */
    private function scanLocation(ScanDevice $device, ?SpiPutawayTask $task, array $hit, array $data)
    {
        /* No task yet: the rack was scanned before any box. Nothing can be
           judged, so the location is handed back for the page to hold and
           re-present with the box scan. Resolved here anyway, so a bad id is
           caught now rather than two scans later. */
        if (!$task) {
            // Its OWN kind. Passing 'shelf' for anything non-zone made a rack
            // label report the shelf that happened to share its id.
            $name = $this->nameLocation($hit['kind'], $hit['id'], $device);
            if (!$name) {
                return $this->refuse(null, $device, 'unknown_location',
                    "No {$hit['kind']} on this account matches that label.", $data);
            }

            /* Is anything actually due here?
               Staging a location that no open task points at sends the
               operator looking for a box that does not exist — the screen
               says "scan the box" and every box they try will be refused.
               Cheaper to say it now. */
            // Count against the column for THIS kind. 'shelf_id' for a rack
            // scan counted tasks whose shelf happened to share the rack's id.
            $col = ['zone' => 'zone_id', 'rack' => 'rack_id', 'shelf' => 'shelf_id'][$hit['kind']] ?? 'shelf_id';

            $dueTasks = SpiPutawayTask::where('client_id', $device->client_id)
                ->open()->where($col, $hit['id'])
                ->with(['box:id,box_code', 'invoice:id,code'])
                ->orderBy('issued_at')
                ->limit(25)
                ->get();

            $due = $dueTasks->count();

            /* Nothing due — so answer the other question instead.
               A refusal here wastes the scan. The operator is standing at the
               location with the label already read; what they want next is
               almost always "what is in here?". Same scan, useful answer. */
            if ($due === 0) {
                $this->log2($device, PutawayActivityLog::SCAN_PASSED, [
                    'meta' => ['act' => 'lookup', 'slot' => $hit['kind'], 'location_id' => $hit['id']],
                ]);

                return response()->json(['status' => true, 'data' => [
                    'device'     => $this->deviceBody($device),
                    'task'       => null,
                    'due_here'   => 0,
                    'step'       => 'lookup',
                    'step_label' => $name,
                    'location'   => $this->locationContents($hit['kind'], (int) $hit['id'], $name, (int) $device->client_id),
                ]], 200);
            }

            return response()->json(['status' => true, 'data' => [
                'staged_location' => $hit['id'],
                'staged_kind'     => $hit['kind'],
                'staged_name'     => $name,
                'due_here'        => $due,
                /* WHICH boxes, not just how many. "3 boxes due here" sends the
                   operator hunting; the codes let them pick one off the trolley. */
                'due_boxes'       => $dueTasks->map(fn (SpiPutawayTask $t) => [
                    'id'          => (int) $t->id,
                    'task_code'   => $t->task_code,
                    // Tapping a row scans that box, so the id has to travel.
                    'box_id'      => (int) $t->box_id,
                    'box_code'    => $t->box?->box_code,
                    'spi_code'    => $t->invoice?->code,
                    'step'        => $t->currentStep(),
                    'step_label'  => $t->stepLabel(),
                    'destination' => $this->describe($t),
                    // Untouched or half-walked — the floor sorts them apart.
                    'started'     => (bool) ($t->box_scan_at || $t->zone_scan_at || $t->rack_scan_at || $t->shelf_scan_at),
                ])->values(),
                'step'            => 'scan_box',
                'step_label'      => $due === 1
                    ? 'Scan the box for ' . $name
                    : "{$due} boxes due at {$name} — scan one",
                'device'          => $this->deviceBody($device),
                'task'            => null,
                // The same picture as a lookup: standing here, what is here.
                'location'        => $this->locationContents($hit['kind'], (int) $hit['id'], $name, (int) $device->client_id),
            ]], 200);
        }

        if ($task->shelf_scan_at) {
            return $this->refuse($task, $device, 'already_scanned',
                'That location is already scanned for this task.', $data);
        }

        $kind = $hit['kind'];

        /* ANY LEVEL OF THE ADDRESS IS ACCEPTED — zone, rack or shelf — because
           operators prove where they are in whichever way suits the aisle.
           What must hold is that the level scanned IS this task's level: the
           task's own rack, not merely some rack. */
        $expected = $task->levelIdFor($kind);

        if ($expected === null) {
            return $this->refuse($task, $device, 'wrong_label_type',
                'That is a ' . $kind . ' label, and this put-away has no ' . $kind
                . '. Scan the ' . $task->locationSlot() . ' — ' . $this->describe($task) . '.', $data);
        }

        /* THE KIND BEFORE THE ID. Shelves, racks and zones number from their
           own sequences, so shelf 1, rack 1 and zone 1 all exist at once —
           comparing ids alone would take a rack label as proof of standing at
           the shelf. levelIdFor() has already matched kind to kind. */
        if ((int) $hit['id'] !== $expected) {
            // A label naming nothing is a different fault from the wrong
            // place, and "a different rack — unknown" describes neither.
            $at = $this->nameLocation($kind, (int) $hit['id'], $device);

            return $this->refuse($task, $device, 'wrong_location',
                $at
                    ? $this->boxCode($task) . ' goes to ' . $this->describe($task) . ". You are at {$at}."
                    : "No {$kind} on this account matches that label.",
                $data);
        }

        // Right id, but the row has to be real, active and in this warehouse.
        $why = $this->locationUsable($kind, $expected, $task);
        if ($why) return $this->refuse($task, $device, 'location_unusable', $why, $data);

        // Marks this level and every level above it — a shelf proves its rack.
        $task->markLocationScanned($kind);
        $task->forceFill(['fail_count' => 0, 'updated_by' => $device->actorId()])->save();

        $this->log($task, $device, PutawayActivityLog::SCAN_PASSED, [
            'meta' => ['act' => 'scan', 'slot' => $kind, 'value' => $data['scanned_value']],
        ]);

        return response()->json(['status' => true, 'data' => $this->state($task->refresh(), $device)], 200);
    }

    /* ════════════════════════════ REFUSALS ════════════════════════════ */

    /**
     * A refused scan: logged, counted, and on the third one in a row the
     * operator is sent back to the box.
     *
     * Written OUTSIDE any transaction on purpose. The log row is the only
     * thing a refusal leaves behind, and a rollback would destroy the one
     * record it exists to make.
     */
    /**
     * @param array $extra Anything the screen needs to explain this refusal.
     * @param bool  $blame Whether it counts against the task's attempts. A
     *                     scan that proves nothing about THIS put-away — a
     *                     carton already away, say — must not burn one.
     */
    private function refuse(?SpiPutawayTask $task, ScanDevice $device, string $code, string $message, array $data, array $extra = [], bool $blame = true)
    {
        $reset = false;

        if ($task && !$blame) {
            $this->log($task, $device, PutawayActivityLog::SCAN_FAILED, [
                'meta' => ['act' => 'scan', 'reason' => $code, 'value' => $data['scanned_value'] ?? null, 'reset' => false],
            ]);
        }

        if ($task && $blame) {
            $task->forceFill([
                'fail_count'    => (int) $task->fail_count + 1,
                'failed_reason' => $code,
            ])->save();

            if ((int) $task->fail_count >= SpiPutawayTask::MAX_FAILS) {
                $task->resetScans();
                $reset   = true;
                $message .= ' Three failed scans — start again from the box.';
            }

            $this->log($task, $device, PutawayActivityLog::SCAN_FAILED, [
                'meta' => [
                    'act'    => 'scan', 'reason' => $code, 'value' => $data['scanned_value'] ?? null,
                    'reset'  => $reset,
                ],
            ]);
        }

        return response()->json([
            'status'        => false,
            'code'          => $code,
            'message'       => $message,
            'reset'         => $reset,
            'attempts_left' => $task ? max(0, SpiPutawayTask::MAX_FAILS - (int) $task->fail_count) : null,
            'data'          => $task ? $this->state($task->refresh(), $device) : null,
        ] + $extra, 422);
    }

    /** A plain refusal with no scan behind it — nothing to count. */
    private function reject(string $message, SpiPutawayTask $task, ScanDevice $device)
    {
        return response()->json([
            'status' => false, 'message' => $message,
            'data'   => $this->state($task, $device),
        ], 422);
    }

    /* ════════════════════════════ HELPERS ════════════════════════════ */

    /**
     * The handheld, proved by its credential.
     *
     * Everything downstream scopes to $device->client_id, so this is the only
     * place a tenant is established for these endpoints.
     */
    private function device(Request $request): ScanDevice
    {
        // Cert-only first: the front door (proxy / Apache) verifies the client
        // certificate and passes its CN here, having stripped any client-sent
        // copy — so this header is trustworthy and the device needs no token.
        // The old X-Scan-Device token still works as a fallback.
        $device = $this->deviceFromCert($request)
            ?: ScanDevice::findByToken((string) ($request->header('X-Scan-Device') ?: $request->input('device_token')));

        if (!$device) {
            abort(response()->json([
                'status' => false, 'code' => 'rejected_unauthorized_device',
                'message' => 'This device is not authorised to scan.',
            ], 401));
        }

        if (!$device->isActive()) {
            abort(response()->json([
                'status'  => false,
                'code'    => $device->status === 'suspended' ? 'rejected_suspended_device' : 'rejected_unauthorized_device',
                'message' => $device->status === 'suspended'
                    ? 'This device has been suspended. Contact your administrator.'
                    : 'This device can no longer scan.',
            ], 403));
        }

        /* Act as the person who enrolled this handheld.
         *
         * Not cosmetic. Half the machinery below reaches for auth()->user()
         * without being asked to — the tenant trait that fills client_id,
         * SupplierInvoiceService::log()'s performed_by — and on a request with
         * no session those come back null and hit a NOT NULL column at the
         * last step. Resolving the actor here fixes all of them in one place,
         * and it is what the device MEANS: it is that person's credential.
         *
         * setUser() only populates the guard for this request. No session is
         * started and no token is issued.
         */
        $actor = $device->actorId()
            ? User::where('client_id', $device->client_id)->find($device->actorId())
            : null;

        if (!$actor) {
            abort(response()->json([
                'status'  => false,
                'code'    => 'device_unclaimed',
                'message' => 'This device has no enrolled user. Open the enrollment link on it and sign in.',
            ], 403));
        }

        Auth::setUser($actor);

        /* And the tenant, which auth() alone does not carry.
         *
         * TenantContext is normally set by middleware on the logged-in routes;
         * these are public, so nothing had set it and BelongsToTenant was
         * filling client_id with null — invisible until it reached the one
         * table with a NOT NULL on that column, at the last step of a
         * put-away. Setting it here also turns the tenant scope back on, so a
         * device can only ever reach its own client's rows.
         */
        TenantContext::fromUser($actor);

        $device->forceFill(['last_seen_at' => now()])->save();

        return $device;
    }

    /**
     * Resolve the handheld from its client certificate's CN, which the front
     * door injects as X-Scan-Cert-CN after verifying it against the Device CA.
     * The CN is "zebra-<serial>"; the serial is the device's own serial. Null
     * when no cert CN is present, so the caller falls back to the token.
     */
    private function deviceFromCert(Request $request): ?ScanDevice
    {
        $cn = trim((string) $request->header('X-Scan-Cert-CN'));
        if ($cn === '') return null;

        $serial = trim(preg_replace('/^zebra-/i', '', $cn));
        return $serial === '' ? null : ScanDevice::where('serial', $serial)->first();
    }

    private function findTask(ScanDevice $device, int $taskId, bool $mustBeOpen = true): SpiPutawayTask
    {
        $task = SpiPutawayTask::where('client_id', $device->client_id)->find($taskId);

        if (!$task) {
            abort(response()->json(['status' => false, 'message' => "No put-away task found with id {$taskId}."], 404));
        }
        if ($mustBeOpen && !$task->isOpen()) {
            // Say what happened to it, in the words the floor uses. The status
            // column is a developer's word: "is scanned — it can no longer be
            // scanned" is both circular and no help to anyone holding a box.
            abort(response()->json([
                'status'  => false,
                'message' => match ($task->status) {
                    SpiPutawayTask::SCANNED   => "{$task->task_code} is already finished — that box is put away.",
                    SpiPutawayTask::CANCELLED => "{$task->task_code} was cancelled. Ask for a new task.",
                    SpiPutawayTask::EXPIRED   => "{$task->task_code} expired before it was scanned. Ask for a new task.",
                    default                   => "{$task->task_code} is closed and can no longer be scanned.",
                },
            ], 422));
        }

        return $task;
    }

    /**
     * What a scanned string is.
     *
     * Four shapes reach here and all of them still exist on labels in the
     * building: the signed sticker URL, the short 'SH:41' form, a typed code,
     * and a bare box id from the oldest stickers.
     */
    private function classify(string $value): array
    {
        if ($p = StickerKey::parse($value)) {
            return [
                'kind'   => match ($p['type']) {
                    'BOX' => 'box', 'SHELF' => 'shelf', 'RACK' => 'rack', 'ZONE' => 'zone',
                    default => null,
                },
                'id'     => ctype_digit($p['id']) ? (int) $p['id'] : null,
                'signed' => true,
                'valid'  => $p['valid'],
            ];
        }

        $v = trim($value);

        if (preg_match('/^(SH|RC|ZN):(\d+)$/i', $v, $m)) {
            return [
                'kind'   => ['SH' => 'shelf', 'RC' => 'rack', 'ZN' => 'zone'][strtoupper($m[1])],
                'id'     => (int) $m[2], 'signed' => false, 'valid' => true,
            ];
        }

        // A bare number is a box: that is what the first sticker run encoded.
        if (ctype_digit($v)) {
            return ['kind' => 'box', 'id' => (int) $v, 'signed' => false, 'valid' => true];
        }

        return ['kind' => null, 'id' => null, 'signed' => false, 'valid' => false];
    }

    /** Real, active, and in this task's warehouse — or why not. */
    private function locationUsable(string $slot, int $id, SpiPutawayTask $task): ?string
    {
        $row = match ($slot) {
            'zone'  => DB::table('inventory_zones')->where('id', $id)->first(['id', 'status', 'warehouse_id']),
            'rack'  => DB::table('inventory_racks')->where('id', $id)->first(['id', 'status', 'warehouse_id']),
            default => DB::table('inventory_shelves')->where('id', $id)->first(['id', 'status', 'rack_id']),
        };

        if (!$row) return 'That location no longer exists.';
        if ((int) $row->status !== 1) return 'That location is not active — it cannot take stock.';

        if (in_array($slot, ['zone', 'rack'], true) && (int) $row->warehouse_id !== (int) $task->warehouse_id) {
            return "That {$slot} is in a different warehouse.";
        }

        return null;
    }

    /**
     * A location's printed code, for a message that names where they stand.
     *
     * Each kind reads from its own table. This used to send anything that was
     * not a zone down the shelf path, so a RACK id was rendered as a shelf
     * code — and because rack 1 and shelf 1 both exist, it produced a
     * confident, wrong answer rather than failing.
     */
    private function nameLocation(string $slot, ?int $id, ?ScanDevice $device = null): ?string
    {
        if (!$id) return null;

        if ($slot === 'zone') return DB::table('inventory_zones')->where('id', $id)->value('code');
        if ($slot === 'rack') return DB::table('inventory_racks')->where('id', $id)->value('code');

        $shelf = DB::table('inventory_shelves')->where('id', $id)->first(['rack_id', 'level_no']);
        if (!$shelf) return null;

        $rack = DB::table('inventory_racks')->where('id', $shelf->rack_id)->value('code');

        return ($rack ?: 'RC-???') . '-SH-' . str_pad((string) $shelf->level_no, 2, '0', STR_PAD_LEFT);
    }

    /**
     * What is actually in a location right now.
     *
     * Read from inventory_location_occupancy, not from the shelf's own
     * counters: those are a recomputed cache, and this has to list the boxes
     * anyway. Reserved rows are included and marked — a box on its way here
     * is occupying the space even though nobody has put it down yet, and an
     * operator looking at a half-empty shelf needs to know it is spoken for.
     */
    /** The handling flags the packer ticked, named, deduped across lines. */
    private function boxFlags(?SpiBox $box): array
    {
        $ids = collect($box?->items ?? [])
            ->flatMap(fn ($i) => is_array($i->flags) ? $i->flags : (json_decode((string) $i->flags, true) ?: []))
            ->map(fn ($v) => (int) $v)->filter()->unique()->values();

        if ($ids->isEmpty()) return [];

        return DB::table('inventory_product_flags')->whereIn('id', $ids)
            ->orderBy('id')->get(['id', 'flag_name', 'behaviour'])
            ->map(fn ($f) => ['id' => (int) $f->id, 'name' => $f->flag_name, 'behaviour' => $f->behaviour])
            ->all();
    }

    /**
     * What is inside a carton, as the floor reads it: a picture, a name, a
     * segment and a quantity per line.
     *
     * The product master carries the picture and the segment; the invoice line
     * carries what was actually billed, and the box item what was packed. One
     * query for the products rather than one per line.
     */
    private function boxProducts(?SpiBox $box): array
    {
        $items = $box?->items ?? collect();
        if ($items->isEmpty()) return [];

        $ids = $items->map(fn ($i) => $i->invoiceItem?->product_id)->filter()->unique()->values();

        $products = $ids->isEmpty() ? collect() : DB::table('products as p')
            ->leftJoin('clm_segments as s', 's.id', '=', 'p.segment_id')
            ->leftJoin('master_uom as u', 'u.id', '=', 'p.uom_id')
            ->whereIn('p.id', $ids)
            ->get(['p.id', 'p.product_code', 'p.name', 'p.brand', 'p.generic_name', 'p.primary_image',
                   's.name as segment', 'u.short_code as uom'])
            ->keyBy('id');

        $n = 0;

        return $items->map(function ($i) use ($products, &$n) {
            $line = $i->invoiceItem;
            $p    = $line?->product_id ? ($products[$line->product_id] ?? null) : null;

            return [
                'sr'          => ++$n,
                'product_id'  => $p?->id,
                'code'        => $p?->product_code,
                'name'        => $p?->name ?: ($line?->description ?: '—'),
                'segment'     => $p?->segment,
                'brand'       => $p?->brand,
                'generic'     => $p?->generic_name,
                'image'       => $p?->primary_image ? file_url($p->primary_image) : null,
                'description' => $line?->description,
                'hsn'         => $line?->hsn_code,
                'quantity'    => (float) $i->quantity,
                'uom'         => $line?->uom ?: $p?->uom,
                // Stamped on the carton's own line, not on the product.
                'batch_no'    => $i->batch_no,
                'lot_no'      => $i->lot_no,
                'serial_no'   => $i->serial_no,
                'cat_no'      => $i->cat_no,
                'expiry_date' => $i->expiry_date ? (string) $i->expiry_date : null,
                'remark'      => $i->remark,
            ];
        })->values()->all();
    }

    /** Zone / rack / shelf codes for a location, read upwards from what was scanned. */
    private function addressOf(string $slot, int $id): array
    {
        $zoneId = null;
        $rack   = null;
        $shelf  = null;

        if ($slot === 'shelf') {
            $row   = DB::table('inventory_shelves')->where('id', $id)->first(['shelf_name', 'rack_id']);
            $shelf = $row?->shelf_name;
            $rk    = $row ? DB::table('inventory_racks')->where('id', $row->rack_id)->first(['code', 'zone_id']) : null;
            $rack  = $rk?->code;
            $zoneId = $rk?->zone_id;
        } elseif ($slot === 'rack') {
            $rk     = DB::table('inventory_racks')->where('id', $id)->first(['code', 'zone_id']);
            $rack   = $rk?->code;
            $zoneId = $rk?->zone_id;
        } else {
            $zoneId = $id;
        }

        return [
            'zone'  => $zoneId ? DB::table('inventory_zones')->where('id', $zoneId)->value('code') : null,
            'rack'  => $rack,
            'shelf' => $shelf,
        ];
    }

    /**
     * The master's own description of a location, as label/value rows.
     *
     * Flat pairs rather than a shaped object: what is worth showing differs
     * per kind (a zone has a temperature band, a shelf a weight limit), and
     * the screen should not have to know which.
     */
    private function locationDetails(string $slot, int $id): array
    {
        $flag = fn ($v) => $v ? 'Allowed' : 'Not allowed';
        $dims = function ($row) {
            if (!$row || !$row->length || !$row->width || !$row->height) return null;
            $u = $row->dim_unit ?: 'cm';

            return sprintf('%s × %s × %s %s', (float) $row->length, (float) $row->width, (float) $row->height, $u);
        };

        $rows = [];

        if ($slot === 'rack') {
            $r = DB::table('inventory_racks')->where('id', $id)->first();
            if (!$r) return [];
            $z = DB::table('inventory_zones')->where('id', $r->zone_id)->first(['code', 'zone_name', 'rack_mode']);
            $w = DB::table('inventory_warehouses')->where('id', $r->warehouse_id)->first(['code', 'wh_name', 'wh_type']);

            $rows[] = ['label' => 'Warehouse', 'value' => trim(($w->code ?? '') . ' · ' . ($w->wh_name ?? ''), ' ·')];
            $rows[] = ['label' => 'Zone',      'value' => trim(($z->code ?? '') . ' · ' . ($z->zone_name ?? ''), ' ·')];
            $rows[] = ['label' => 'Rack',      'value' => trim(($r->code ?? '') . ' · ' . ($r->rack_name ?? ''), ' ·')];
            if ($d = $dims($r))   $rows[] = ['label' => 'Dimensions', 'value' => $d];
            if ($r->area_sqft)    $rows[] = ['label' => 'Area', 'value' => (float) $r->area_sqft . ' sq.ft'];
            $rows[] = ['label' => 'Cold chain', 'value' => $flag($r->cold_chain)];
            $rows[] = ['label' => 'Hazardous',  'value' => $flag($r->hazardous)];

            return $rows;
        }

        if ($slot === 'shelf') {
            $s = DB::table('inventory_shelves')->where('id', $id)->first();
            if (!$s) return [];
            $r = DB::table('inventory_racks')->where('id', $s->rack_id)->first(['code', 'rack_name', 'zone_id', 'warehouse_id']);
            $z = $r ? DB::table('inventory_zones')->where('id', $r->zone_id)->first(['code', 'zone_name']) : null;
            $w = $r ? DB::table('inventory_warehouses')->where('id', $r->warehouse_id)->first(['code', 'wh_name']) : null;

            $rows[] = ['label' => 'Warehouse', 'value' => trim(($w->code ?? '') . ' · ' . ($w->wh_name ?? ''), ' ·')];
            $rows[] = ['label' => 'Zone',      'value' => trim(($z->code ?? '') . ' · ' . ($z->zone_name ?? ''), ' ·')];
            $rows[] = ['label' => 'Rack',      'value' => trim(($r->code ?? '') . ' · ' . ($r->rack_name ?? ''), ' ·')];
            $rows[] = ['label' => 'Shelf',     'value' => $s->shelf_name ?: ('Level ' . $s->level_no)];
            if ($s->shelf_type)   $rows[] = ['label' => 'Type', 'value' => $s->shelf_type];
            if ($d = $dims($s))   $rows[] = ['label' => 'Dimensions', 'value' => $d];
            if ($s->height_cm)    $rows[] = ['label' => 'Clearance', 'value' => (float) $s->height_cm . ' cm'];
            $rows[] = ['label' => 'Cold chain', 'value' => $flag($s->cold_chain)];
            $rows[] = ['label' => 'Hazardous',  'value' => $flag($s->hazardous)];

            return $rows;
        }

        $z = DB::table('inventory_zones')->where('id', $id)->first();
        if (!$z) return [];
        $w = DB::table('inventory_warehouses')->where('id', $z->warehouse_id)->first(['code', 'wh_name']);

        $rows[] = ['label' => 'Warehouse', 'value' => trim(($w->code ?? '') . ' · ' . ($w->wh_name ?? ''), ' ·')];
        $rows[] = ['label' => 'Zone',      'value' => trim(($z->code ?? '') . ' · ' . ($z->zone_name ?? ''), ' ·')];
        $rows[] = ['label' => 'Storage',   'value' => $z->rack_mode === 'rack' ? 'Racked' : 'Floor (no racks)'];
        if ($z->temp_min_c !== null || $z->temp_max_c !== null) {
            $rows[] = ['label' => 'Temperature', 'value' => sprintf('%s … %s °C', (float) $z->temp_min_c, (float) $z->temp_max_c)];
        }
        $rows[] = ['label' => 'Cold chain', 'value' => $flag($z->cold_chain)];
        $rows[] = ['label' => 'Hazardous',  'value' => $flag($z->hazardous)];

        return $rows;
    }

    /**
     * What sits one level down, with the work owed to each.
     *
     * A rack label is scanned by someone standing in front of several
     * shelves; telling them the rack has three boxes due without saying WHICH
     * shelf leaves them opening every one.
     */
    private function locationChildren(string $slot, int $id, ?int $clientId): array
    {
        if ($slot === 'rack') {
            $kids = DB::table('inventory_shelves')->where('rack_id', $id)
                ->orderBy('level_no')->get(['id', 'shelf_name', 'level_no', 'max_weight_kg', 'status']);
            $col = 'shelf_id';
        } elseif ($slot === 'zone') {
            /* A floor zone stores cartons on the floor, so there is no level
               below it — the boxes themselves are the answer, not racks. */
            if (DB::table('inventory_zones')->where('id', $id)->value('rack_mode') !== 'rack') return [];

            $kids = DB::table('inventory_racks')->where('zone_id', $id)
                ->orderBy('code')->get(['id', 'code', 'rack_name', 'status']);
            $col = 'rack_id';
        } else {
            return [];
        }

        if ($kids->isEmpty()) return [];

        $ids = $kids->pluck('id')->all();

        // Two grouped reads rather than one per child.
        $due = $clientId
            ? SpiPutawayTask::where('client_id', $clientId)->open()->whereIn($col, $ids)
                ->with(['box:id,box_code', 'invoice:id,code'])->get()->groupBy($col)
            : collect();

        $held = DB::table('inventory_location_occupancy')
            ->whereIn($col, $ids)
            ->whereIn('status', [LocationOccupancy::RESERVED, LocationOccupancy::OCCUPIED])
            ->get(['occupant_id', 'box_code', 'weight_kg', 'status', $col])
            ->groupBy($col);

        /* A rack is read by how many shelves it offers, not by how many
           cartons happen to be on it — that is the shelf's question. */
        $shelves = $slot === 'zone'
            ? DB::table('inventory_shelves')->whereIn('rack_id', $ids)
                ->selectRaw('rack_id, count(*) as n')->groupBy('rack_id')->pluck('n', 'rack_id')
            : collect();

        return $kids->map(function ($k) use ($slot, $due, $held, $shelves) {
            $mine  = collect($due[$k->id] ?? []);
            $boxes = collect($held[$k->id] ?? []);

            return [
                'id'      => (int) $k->id,
                'kind'    => $slot === 'rack' ? 'shelf' : 'rack',
                'code'    => $slot === 'rack' ? $this->nameLocation('shelf', (int) $k->id) : $k->code,
                'name'    => $slot === 'rack' ? ($k->shelf_name ?: ('Level ' . $k->level_no)) : $k->rack_name,
                'active'  => (int) ($k->status ?? 1) === 1,
                'max_weight_kg' => $slot === 'rack' && $k->max_weight_kg ? (float) $k->max_weight_kg : null,
                'used_weight_kg' => round((float) $boxes->sum('weight_kg'), 3),
                'stored'  => $boxes->where('status', LocationOccupancy::OCCUPIED)->count(),
                // Racks are counted in shelves; null on a shelf, which has none.
                'shelves' => $slot === 'zone' ? (int) ($shelves[$k->id] ?? 0) : null,
                'pending' => $mine->map(fn (SpiPutawayTask $t) => [
                    'box_code'   => $t->box?->box_code,
                    'spi_code'   => $t->invoice?->code,
                    'task_code'  => $t->task_code,
                    'step_label' => $t->stepLabel(),
                ])->values(),
            ];
        })->values()->all();
    }

    private function locationContents(string $slot, int $id, string $name, ?int $clientId = null): array
    {
        // Each kind has its own column; a rack is not a shelf with the
        // same number, however often their ids happen to agree.
        $col = ['zone' => 'zone_id', 'rack' => 'rack_id', 'shelf' => 'shelf_id'][$slot] ?? 'shelf_id';

        $rows = DB::table('inventory_location_occupancy')
            ->where($col, $id)
            ->whereIn('status', [LocationOccupancy::RESERVED, LocationOccupancy::OCCUPIED])
            ->orderByDesc('id')
            ->get(['occupant_id', 'box_code', 'weight_kg', 'status', 'placed_at', 'reserved_at']);

        // Only a shelf carries a weight limit — a zone or rack is a sum
        // of its children, and quoting one here would invent a figure.
        $cap = $slot === 'shelf'
            ? (float) DB::table('inventory_shelves')->where('id', $id)->value('max_weight_kg')
            : null;

        $used = (float) $rows->sum('weight_kg');

        return [
            'kind'     => $slot,
            'id'       => $id,
            'name'     => $name,
            // The address as its parts, so the screen can show where this is
            // rather than make the operator read it out of one long string.
            'address'  => $this->addressOf($slot, $id) + ['code' => $name],
            'details'  => $this->locationDetails($slot, $id),
            'children' => $this->locationChildren($slot, $id, $clientId),
            'boxes'    => $rows->map(fn ($r) => [
                'box_id'    => (int) $r->occupant_id,
                'box_code'  => $r->box_code,
                'weight_kg' => $r->weight_kg !== null ? (float) $r->weight_kg : null,
                'status'    => $r->status,
                // The word an operator would use, not the column's.
                'state'     => $r->status === LocationOccupancy::OCCUPIED ? 'stored' : 'on its way',
                'since'     => $r->placed_at ?: $r->reserved_at,
            ])->values(),
            'count'          => $rows->count(),
            'used_weight_kg' => round($used, 3),
            'max_weight_kg'  => $cap ?: null,
            'free_weight_kg' => $cap ? round(max(0, $cap - $used), 3) : null,
            'used_pct'       => $cap > 0 ? round($used / $cap * 100, 1) : null,
        ];
    }

    /**
     * Clear a half-finished scan that has been sitting too long.
     *
     * Enforced HERE rather than in the page, because the page is reloaded on
     * every camera scan and anything it was holding could simply be re-sent.
     * The server is the only place that can say how old a scan really is.
     *
     * Logged, so a run that restarted mid-aisle is visible afterwards —
     * otherwise the trail shows a box scanned twice with no reason why.
     */
    private function dropStaleScans(SpiPutawayTask $task, ScanDevice $device): bool
    {
        if (!$task->scansAreStale()) return false;

        $age = (int) round((float) $task->lastScanAt()?->diffInMinutes(now()));
        $task->resetScans();

        $this->log($task, $device, PutawayActivityLog::SCAN_FAILED, [
            'meta' => ['act' => 'stale_reset', 'reason' => 'inactive', 'minutes' => $age],
        ]);

        return true;
    }

    /** An activity row with no task behind it — a lookup, not a put-away. */
    private function log2(ScanDevice $device, string $event, array $attrs): void
    {
        $this->activity->log(
            $event, 'device', (int) $device->id,
            (int) $device->client_id, null, $device->actorId(),
            array_merge(['device_id' => $device->id], $attrs),
            'device',
        );
    }

    /** The full address a task points at. */
    private function describe(SpiPutawayTask $task): string
    {
        $wh   = DB::table('inventory_warehouses')->where('id', $task->warehouse_id)->value('code');
        $zone = $task->zone_id ? DB::table('inventory_zones')->where('id', $task->zone_id)->value('code') : null;
        $rack = $task->rack_id ? DB::table('inventory_racks')->where('id', $task->rack_id)->value('code') : null;
        $shelf = $task->shelf_id ? $this->nameLocation('shelf', (int) $task->shelf_id) : null;

        return implode(' / ', array_filter([$wh, $zone, $rack, $shelf]));
    }

    /**
     * How a carton is named to an operator.
     *
     * Always WITH its invoice. box_code restarts at B-001 for every supplier
     * invoice, so "this task wants B-001" is four different cartons on a busy
     * floor and tells the person holding one of them nothing.
     */
    private function boxCode(SpiPutawayTask $task): string
    {
        $code = $task->box?->box_code ?: ('Box ' . $task->box_id);
        $spi  = $task->invoice?->code;

        return $spi ? "{$code} of {$spi}" : $code;
    }

    private function log(SpiPutawayTask $task, ScanDevice $device, string $event, array $attrs): void
    {
        $this->activity->log(
            $event, 'task', (int) $task->id,
            (int) $task->client_id, $task->branch_id, $device->actorId(),
            array_merge([
                'task_id'    => $task->id,
                'putaway_id' => $task->putaway_id,
                'box_id'     => $task->box_id,
                'device_id'  => $device->id,
            ], $attrs),
            'device',
        );
    }

    private function releaseLockFor(LocationOccupancy $occ, ?int $actorId): void
    {
        $lock = $this->locks->held($occ->locationType(), $occ->locationId());
        if ($lock) $this->locks->release($lock, LocationLock::RELEASED_COMPLETED, $actorId);
    }

    private function deviceBody(ScanDevice $device): array
    {
        return $device->toClient() + [
            'actor_id' => $device->actorId(),
            /* Whether a PERSON has claimed this handheld, as opposed to it
               falling back to the admin who added the row. The page uses this
               to offer binding once, quietly, instead of asking every shift. */
            'claimed'  => $device->enrolled_by !== null,
        ];
    }

    /** Everything the scan page draws, in one shape for every endpoint. */
    private function state(SpiPutawayTask $task, ScanDevice $device): array
    {
        $task->loadMissing(['box.items.invoiceItem', 'invoice:id,code']);
        $box = $task->box;

        return [
            'device' => $this->deviceBody($device),
            'task'   => [
                'id'                 => (int) $task->id,
                'task_code'          => $task->task_code,
                'status'             => $task->status,
                'step'               => $task->currentStep(),
                'step_label'         => $task->stepLabel(),
                'expected'           => $task->expectedScans(),
                'location_slot'      => $task->locationSlot(),
                /* The address as steps, so the screen can show how far in the
                   operator is. Scanning the shelf ticks all three at once. */
                'chain'              => array_map(fn (array $s) => $s + [
                    'name' => $this->nameLocation($s['kind'], $s['id']),
                ], $task->locationChain()),
                'next_level'         => $task->nextLocationLevel(),
                'required_scans'     => (int) $task->required_scans,
                'completed_scans'    => (int) $task->completed_scans,
                'fail_count'         => (int) $task->fail_count,
                'attempts_left'      => max(0, SpiPutawayTask::MAX_FAILS - (int) $task->fail_count),
                'box_scan_at'        => optional($task->box_scan_at)->toIso8601String(),
                'box_confirmed_at'   => optional($task->box_confirmed_at)->toIso8601String(),
                'shelf_scan_at'      => optional($task->shelf_scan_at)->toIso8601String(),
                'shelf_confirmed_at' => optional($task->shelf_confirmed_at)->toIso8601String(),
                'ready_to_complete'  => $task->readyToComplete(),
                /* The idle clock, so the handheld can give up a half-walked
                   run on its own. The page owns no threshold of its own. */
                'last_activity_at'   => optional($task->lastScanAt())->toIso8601String(),
                'idle_after_minutes' => (int) config('inventory.scan_stale_minutes', 5),
                'idle_seconds_left'  => $task->idleSecondsLeft(),
                'issued_at'          => optional($task->issued_at)->toIso8601String(),
                'expires_at'         => optional($task->expires_at)->toIso8601String(),
            ],
            'box' => $box ? [
                'id'              => (int) $box->id,
                'box_code'        => $box->box_code,
                'putaway_code'    => 'PUT-' . $box->box_code,
                'spi_code'        => $task->invoice?->code,
                'scenario'        => $box->scenario,
                'scenario_label'  => match ($box->scenario) {
                    's1' => '1 product → 1 box',
                    's2' => '1 product → multiple boxes',
                    's3' => 'Multiple products → 1 box',
                    default => $box->scenario,
                },
                'condition'       => $box->condition,
                'is_stackable'    => $box->is_stackable === null ? null : (bool) $box->is_stackable,
                'length_cm'       => $box->length_cm !== null ? (float) $box->length_cm : null,
                'width_cm'        => $box->width_cm !== null ? (float) $box->width_cm : null,
                'height_cm'       => $box->height_cm !== null ? (float) $box->height_cm : null,
                'weight_kg'       => $box->weight_kg !== null ? (float) $box->weight_kg : null,
                'net_weight_kg'   => $box->net_weight_kg !== null ? (float) $box->net_weight_kg : null,
                'gross_weight_kg' => $box->gross_weight_kg !== null ? (float) $box->gross_weight_kg : null,
                /* Volumetric weight, the same divisor the packing screen uses.
                   Shown because a light, bulky carton is charged on this. */
                'vol_weight_kg'   => $box->length_cm && $box->width_cm && $box->height_cm
                    ? round(((float) $box->length_cm * (float) $box->width_cm * (float) $box->height_cm) / 5000, 2)
                    : null,
                'temp_min_c'      => $box->temp_min_c !== null ? (float) $box->temp_min_c : null,
                'temp_max_c'      => $box->temp_max_c !== null ? (float) $box->temp_max_c : null,
                'flags'           => $this->boxFlags($box),
                'dimensions_cm'   => $box->length_cm && $box->width_cm && $box->height_cm
                    ? sprintf('%s x %s x %s', (float) $box->length_cm, (float) $box->width_cm, (float) $box->height_cm)
                    : null,
                'products' => $this->boxProducts($box),
            ] : null,
            'destination' => [
                'full'       => $this->describe($task),
                'warehouse'  => DB::table('inventory_warehouses')->where('id', $task->warehouse_id)->value('code'),
                'zone'       => $task->zone_id ? DB::table('inventory_zones')->where('id', $task->zone_id)->value('code') : null,
                'rack'       => $task->rack_id ? DB::table('inventory_racks')->where('id', $task->rack_id)->value('code') : null,
                'shelf'      => $task->shelf_id ? $this->nameLocation('shelf', (int) $task->shelf_id) : null,
                'zone_id'    => $task->zone_id ? (int) $task->zone_id : null,
                'rack_id'    => $task->rack_id ? (int) $task->rack_id : null,
                'shelf_id'   => $task->shelf_id ? (int) $task->shelf_id : null,
            ],
        ];
    }
}
