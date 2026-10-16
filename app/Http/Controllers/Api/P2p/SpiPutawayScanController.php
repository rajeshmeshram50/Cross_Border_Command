<?php

namespace App\Http\Controllers\Api\P2p;

use App\Http\Controllers\Controller;
use App\Models\Inventory\LocationLock;
use App\Models\Inventory\LocationOccupancy;
use App\Models\Inventory\PutawayActivityLog;
use App\Models\P2p\SpiBox;
use App\Models\P2p\SpiPutaway;
use App\Models\P2p\SpiPutawayTask;
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

        return response()->json(['status' => true, 'data' => $this->state($task, $device)], 200);
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

        $open = SpiPutawayTask::where('box_id', $box->id)
            ->where('client_id', $device->client_id)
            ->open()->first();

        if (!$open) {
            /* Three different situations end up here and they need three
               different answers. "Allocate it first" told the operator to go
               and allocate a box that was already sitting on a shelf — true
               that no task is open, and the worst possible next instruction. */
            $row = SpiPutaway::where('box_id', $box->id)->first();

            /* Name where they are standing, when a location was scanned
               first. "No put-away initiated for B-001" is true but reads as a
               dead end; the operator is at a rack holding a carton and needs
               to know this box is not the one that belongs here. */
            $at = !empty($data['staged_location'])
                ? $this->nameLocation($data['staged_kind'] ?? 'shelf', (int) $data['staged_location'])
                : null;
            $here = $at ? " It does not belong at {$at}." : '';

            if ($row?->isPlaced()) {
                return $this->refuse($task, $device, 'already_placed',
                    "{$box->box_code} is already put away at {$row->destination}. Nothing to do.", $data);
            }

            return $this->refuse($task, $device, 'no_task',
                $row?->zone_id
                    ? "No scan task for {$box->box_code}. It is allocated to {$row->destination} — raise a task, or confirm it by hand."
                    // No instruction: allocating is a back-office action, and
                    // the person holding the box cannot do it from here.
                    : "No put-away initiated for {$box->box_code}.{$here}",
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
                "Wrong box — this task wants {$wants}. {$box->box_code} belongs to {$open->task_code}.", $data);
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
                    "{$box->box_code} is assigned to " . $this->describe($task)
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

            $due = SpiPutawayTask::where('client_id', $device->client_id)
                ->open()->where($col, $hit['id'])->count();

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
                    'location'   => $this->locationContents($hit['kind'], (int) $hit['id'], $name),
                ]], 200);
            }

            return response()->json(['status' => true, 'data' => [
                'staged_location' => $hit['id'],
                'staged_kind'     => $hit['kind'],
                'staged_name'     => $name,
                'due_here'        => $due,
                'step'            => 'scan_box',
                'step_label'      => $due === 1
                    ? 'Scan the box for ' . $name
                    : "{$due} boxes due at {$name} — scan one",
                'device'          => $this->deviceBody($device),
                'task'            => null,
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
    private function refuse(?SpiPutawayTask $task, ScanDevice $device, string $code, string $message, array $data)
    {
        $reset = false;

        if ($task) {
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
        ], 422);
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
        $token  = $request->header('X-Scan-Device') ?: $request->input('device_token');
        $device = ScanDevice::findByToken((string) $token);

        if (!$device) {
            abort(response()->json([
                'status' => false, 'code' => 'rejected_unauthorized_device',
                'message' => 'This device is not enrolled.',
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
    private function locationContents(string $slot, int $id, string $name): array
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

    private function boxCode(SpiPutawayTask $task): string
    {
        return $task->box?->box_code ?: ('Box ' . $task->box_id);
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
                'issued_at'          => optional($task->issued_at)->toIso8601String(),
                'expires_at'         => optional($task->expires_at)->toIso8601String(),
            ],
            'box' => $box ? [
                'id'              => (int) $box->id,
                'box_code'        => $box->box_code,
                'putaway_code'    => 'PUT-' . $box->box_code,
                'spi_code'        => $task->invoice?->code,
                'gross_weight_kg' => $box->gross_weight_kg !== null ? (float) $box->gross_weight_kg : null,
                'dimensions_cm'   => $box->length_cm && $box->width_cm && $box->height_cm
                    ? sprintf('%s x %s x %s', (float) $box->length_cm, (float) $box->width_cm, (float) $box->height_cm)
                    : null,
                'products' => $box->items->map(fn ($i) => [
                    'description' => $i->invoiceItem?->description,
                    'quantity'    => (float) $i->quantity,
                    'uom'         => $i->invoiceItem?->uom,
                ])->values(),
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
