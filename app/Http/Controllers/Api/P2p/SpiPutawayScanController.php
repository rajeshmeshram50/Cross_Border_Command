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

class SpiPutawayScanController extends Controller
{
    public function __construct(
        private LocationOccupancyService $occupancy,
        private LocationLockService $locks,
        private PutawayActivityLogger $activity,
        private SupplierInvoiceService $svc,
    ) {}

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

    public function spiBoxes(Request $request, int $taskId)
    {
        $device = $this->device($request);

        $task = SpiPutawayTask::where('client_id', $device->client_id)->find($taskId);
        if (!$task) abort(response()->json(['status' => false, 'message' => 'Task not found.'], 404));

        $invoice = SupplierInvoice::find($task->supplier_invoice_id);

        $boxes = SpiPutaway::where('client_id', $device->client_id)
            ->where('supplier_invoice_id', $task->supplier_invoice_id)
            ->with('box:id,box_code')
            ->orderBy('id')
            ->get()
            ->map(function (SpiPutaway $p) {
                $placed  = $p->status === SpiPutaway::PLACED;
                $boxQr   = $placed || $p->box_scanned_at !== null;
                $shelfQr = $placed || $p->shelf_scanned_at !== null;

                return [
                    'box_code'    => $p->box?->box_code,
                    'status'      => $placed ? 'placed' : ($boxQr ? 'box_scanned' : 'pending'),
                    'box_qr'      => $boxQr,
                    'shelf_qr'    => $shelfQr,
                    'destination' => $p->destination,
                ];
            })->values();

        return response()->json(['status' => true, 'data' => [
            'spi_code' => $invoice?->code,
            'count'    => $boxes->count(),
            'placed'   => $boxes->where('status', 'placed')->count(),
            'boxes'    => $boxes,
        ]], 200);
    }

    public function show(Request $request, int $taskId)
    {
        $device = $this->device($request);
        $task   = $this->findTask($device, $taskId, false);

        $stale = $task->isOpen() ? $this->dropStaleScans($task, $device) : false;

        $body = ['status' => true, 'data' => $this->state($task, $device)];
        if ($stale) {
            $body['stale_reset'] = true;
            $body['notice']      = 'That put-away was left too long — scan the box again to restart it.';
        }

        return response()->json($body, 200);
    }

    public function scan(Request $request)
    {
        $device = $this->device($request);

        $data = $request->validate([
            'scanned_value'   => ['required', 'string', 'max:255'],
            'task_id'         => ['nullable', 'integer'],
            'staged_location' => ['nullable', 'integer'],
            'staged_kind'     => ['nullable', Rule::in(['shelf', 'zone', 'rack'])],
        ]);

        $hit = $this->classify($data['scanned_value']);

        $task = isset($data['task_id']) ? $this->findTask($device, (int) $data['task_id'], false) : null;
        if ($task && !$task->isOpen()) $task = null;

        $stale = $task ? $this->dropStaleScans($task, $device) : false;

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

        $body = $res->getData(true);
        $done = $body['data']['task']['id'] ?? null;

        if (($body['status'] ?? false) && $done) {
            $fresh = SpiPutawayTask::find($done);

            if ($fresh?->isOpen() && $fresh->readyToComplete()) {
                return $this->commit($fresh, $device);
            }
        }

        if ($stale) {
            $body = $res->getData(true);
            $body['stale_reset'] = true;
            $body['notice'] = 'The earlier scan timed out — starting this box again.';
            $res->setData($body);
        }

        return $res;
    }

    public function confirm(Request $request, int $taskId)
    {
        $device = $this->device($request);
        $task   = $this->findTask($device, $taskId);

        $data = $request->validate([
            'slot' => ['required', Rule::in(['box', 'shelf', 'zone'])],
        ]);

        $slot = $data['slot'] === 'box' ? 'box' : 'shelf';
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

    public function release(Request $request, int $taskId)
    {
        $device = $this->device($request);
        $task   = $this->findTask($device, $taskId);

        $had = [
            'box'   => (bool) $task->box_scan_at,
            'zone'  => (bool) $task->zone_scan_at,
            'rack'  => (bool) $task->rack_scan_at,
            'shelf' => (bool) $task->shelf_scan_at,
        ];

        $task->forceFill([
            'box_scan_at'        => null,
            'box_confirmed_at'   => null,
            'zone_scan_at'       => null,
            'rack_scan_at'       => null,
            'shelf_scan_at'      => null,
            'shelf_confirmed_at' => null,
            'completed_scans'    => 0,
            'device_id'          => null,
            'device_serial'      => null,
        ])->save();

        $this->log($task, $device, PutawayActivityLog::RELEASED, [
            'had_scans' => array_keys(array_filter($had)),
            'reason'    => 'cleared_on_device',
        ]);

        return response()->json([
            'status'  => true,
            'message' => 'Box cleared. Scan it again to start this put-away.',
        ]);
    }

    public function complete(Request $request, int $taskId)
    {
        $device = $this->device($request);
        $task   = $this->findTask($device, $taskId);

        if (!$task->readyToComplete()) {
            return $this->reject('Scan both the box and the location first.', $task, $device);
        }

        return $this->commit($task, $device);
    }

    private function commit(SpiPutawayTask $task, ScanDevice $device)
    {
        $actor = $device->actorId();

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

    private function scanBox(ScanDevice $device, ?SpiPutawayTask $task, array $hit, array $data)
    {
        $box = SpiBox::withoutGlobalScopes()->whereNull('deleted_at')->find($hit['id']);
        if (!$box) {
            return $this->refuse($task, $device, 'unknown_box',
                'No box matches that label.', $data);
        }

        if ((int) $box->client_id !== (int) $device->client_id) {
            return $this->refuse($task, $device, 'device_wrong_client',
                'That box belongs to another organisation. This device is not allocated to it.', $data);
        }

        $deviceBranch = TenantContext::branchId();
        if ($deviceBranch !== null && $box->branch_id !== null
            && (int) $box->branch_id !== (int) $deviceBranch) {
            return $this->refuse($task, $device, 'device_wrong_branch',
                "{$box->box_code} belongs to another branch. Ask your administrator "
                . 'to allocate this device to that branch.', $data);
        }

        $spi = $box->supplier_invoice_id
            ? SupplierInvoice::where('client_id', $device->client_id)->find($box->supplier_invoice_id)
            : null;

        if (!$spi) {
            return $this->refuse($task, $device, 'box_not_packed',
                "{$box->box_code} is not packed against any supplier invoice. It cannot be put away.", $data);
        }

        $open = SpiPutawayTask::where('box_id', $box->id)
            ->where('supplier_invoice_id', $spi->id)
            ->where('client_id', $device->client_id)
            ->open()->first();

        if (!$open) {
            $row = SpiPutaway::where('box_id', $box->id)
                ->where('supplier_invoice_id', $spi->id)
                ->where('client_id', $device->client_id)
                ->latest('id')->first();

            $at = !empty($data['staged_location'])
                ? $this->nameLocation($data['staged_kind'] ?? 'shelf', (int) $data['staged_location'])
                : null;
            $here = $at ? " It does not belong at {$at}." : '';

            if ($row?->isPlaced()) {
                $placed = [
                    'box_code'    => $box->box_code,
                    'spi_code'    => $spi->code,
                    'destination' => $row->destination,
                    'at'          => optional($row->confirmed_at)->toIso8601String(),
                    'method'      => $row->verify_method,
                    'by'          => $row->confirmed_by
                        ? DB::table('users')->where('id', $row->confirmed_by)->value('name')
                        : null,
                ];

                $done = SpiPutawayTask::where('box_id', $box->id)
                    ->where('supplier_invoice_id', $spi->id)
                    ->where('client_id', $device->client_id)
                    ->whereNotNull('completed_at')->latest('completed_at')->first();

                if ($done) {
                    return response()->json([
                        'status'         => true,
                        'notice'         => "{$box->box_code} of {$spi->code} is already put away.",
                        'already_placed' => true,
                        'data'           => $this->state($done, $device) + ['already_placed' => true, 'placed' => $placed],
                    ], 200);
                }

                return $this->refuse($task, $device, 'already_placed',
                    "{$box->box_code} of {$spi->code} is already put away.", $data, ['placed' => $placed], false);
            }

            $named = "{$box->box_code} of {$spi->code}";

            $allocated = $row?->zone_id ? [
                'full'  => $row->destination,
                'zone'  => $row->zone_id ? DB::table('inventory_zones')->where('id', $row->zone_id)->value('code') : null,
                'rack'  => $row->rack_id ? DB::table('inventory_racks')->where('id', $row->rack_id)->value('code') : null,
                'shelf' => $row->shelf_id ? $this->nameLocation('shelf', (int) $row->shelf_id) : null,
            ] : null;

            return response()->json([
                'status'  => true,
                'code'    => 'no_task',
                'no_task' => true,
                'notice'  => $row?->zone_id
                    ? "No put-away task for {$named}. It is allocated to {$row->destination} — raise a task, or confirm it by hand."
                    : "No put-away task for {$named}.{$here} Raise a task, or confirm it by hand.",
                'data'    => [
                    'device'    => $this->deviceBody($device),
                    'task'      => null,
                    'box'       => $this->boxBody($box, $spi->code),
                    'no_task'   => true,
                    'allocated' => $allocated,
                ],
            ], 200);
        }

        if ($task && (int) $task->id !== (int) $open->id) {
            $wants = $this->boxCode($task);

            return $this->refuse($task, $device, 'wrong_box',
                "Wrong box — this task wants {$wants}. {$box->box_code} of {$spi->code} belongs to {$open->task_code}.", $data);
        }

        $task = $open;

        if (!empty($data['staged_location'])) {
            $slot     = $task->locationSlot();
            $expected = (int) ($task->shelf_id ?: $task->zone_id);
            $kindOk   = ($data['staged_kind'] ?? $slot) === $slot;

            if (!$kindOk || (int) $data['staged_location'] !== $expected) {
                return $this->refuse($task, $device, 'wrong_location',
                    "{$box->box_code} of {$spi->code} is assigned to " . $this->describe($task)
                    . '. You are at ' . ($this->nameLocation($data['staged_kind'] ?? $slot, (int) $data['staged_location']) ?: 'a different location') . '.', $data);
            }

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

        return response()->json([
            'status' => true,
            'notice' => "{$box->box_code} · {$task->task_code}",
            'data'   => $this->state($task->refresh(), $device),
        ], 200);
    }

    private function scanLocation(ScanDevice $device, ?SpiPutawayTask $task, array $hit, array $data)
    {
        if (!$task) {
            $name = $this->nameLocation($hit['kind'], $hit['id'], $device);
            if (!$name) {
                return $this->refuse(null, $device, 'unknown_location',
                    "No {$hit['kind']} on this account matches that label.", $data);
            }

            $col = ['zone' => 'zone_id', 'rack' => 'rack_id', 'shelf' => 'shelf_id'][$hit['kind']] ?? 'shelf_id';

            $dueTasks = SpiPutawayTask::where('client_id', $device->client_id)
                ->open()->where($col, $hit['id'])
                ->with(['box:id,box_code', 'invoice:id,code'])
                ->orderBy('issued_at')
                ->limit(25)
                ->get();

            $due = $dueTasks->count();

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
                'due_boxes'       => $dueTasks->map(fn (SpiPutawayTask $t) => [
                    'id'          => (int) $t->id,
                    'task_code'   => $t->task_code,
                    'box_id'      => (int) $t->box_id,
                    'box_code'    => $t->box?->box_code,
                    'spi_code'    => $t->invoice?->code,
                    'step'        => $t->currentStep(),
                    'step_label'  => $t->stepLabel(),
                    'destination' => $this->describe($t),
                    'started'     => (bool) ($t->box_scan_at || $t->zone_scan_at || $t->rack_scan_at || $t->shelf_scan_at),
                ])->values(),
                'step'            => 'scan_box',
                'step_label'      => $due === 1
                    ? 'Scan the box for ' . $name
                    : "{$due} boxes due at {$name} — scan one",
                'device'          => $this->deviceBody($device),
                'task'            => null,
                'location'        => $this->locationContents($hit['kind'], (int) $hit['id'], $name, (int) $device->client_id),
            ]], 200);
        }

        if ($task->shelf_scan_at) {
            return $this->refuse($task, $device, 'already_scanned',
                'That location is already scanned for this task.', $data);
        }

        $kind = $hit['kind'];

        $expected = $task->levelIdFor($kind);

        if ($expected === null) {
            return $this->refuse($task, $device, 'wrong_label_type',
                'That is a ' . $kind . ' label, and this put-away has no ' . $kind
                . '. Scan the ' . $task->locationSlot() . ' — ' . $this->describe($task) . '.', $data);
        }

        if ((int) $hit['id'] !== $expected) {
            $at = $this->nameLocation($kind, (int) $hit['id'], $device);

            return $this->refuse($task, $device, 'wrong_location',
                $at
                    ? $this->boxCode($task) . ' goes to ' . $this->describe($task) . ". You are at {$at}."
                    : "No {$kind} on this account matches that label.",
                $data);
        }

        $why = $this->locationUsable($kind, $expected, $task);
        if ($why) return $this->refuse($task, $device, 'location_unusable', $why, $data);

        $task->markLocationScanned($kind);
        $task->forceFill(['fail_count' => 0, 'updated_by' => $device->actorId()])->save();

        $this->log($task, $device, PutawayActivityLog::SCAN_PASSED, [
            'meta' => ['act' => 'scan', 'slot' => $kind, 'value' => $data['scanned_value']],
        ]);

        return response()->json(['status' => true, 'data' => $this->state($task->refresh(), $device)], 200);
    }

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

    private function reject(string $message, SpiPutawayTask $task, ScanDevice $device)
    {
        return response()->json([
            'status' => false, 'message' => $message,
            'data'   => $this->state($task, $device),
        ], 422);
    }

    private function device(Request $request): ScanDevice
    {
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

        TenantContext::fromUser($actor);

        $device->forceFill(['last_seen_at' => now()])->save();

        return $device;
    }

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

        if (ctype_digit($v)) {
            return ['kind' => 'box', 'id' => (int) $v, 'signed' => false, 'valid' => true];
        }

        return ['kind' => null, 'id' => null, 'signed' => false, 'valid' => false];
    }

    private function locationUsable(string $slot, int $id, SpiPutawayTask $task): ?string
    {
        $row = match ($slot) {
            'zone'  => DB::table('inventory_zones')->where('id', $id)->where('client_id', $task->client_id)->first(['id', 'status', 'warehouse_id']),
            'rack'  => DB::table('inventory_racks')->where('id', $id)->where('client_id', $task->client_id)->first(['id', 'status', 'warehouse_id']),
            default => DB::table('inventory_shelves')->where('id', $id)->where('client_id', $task->client_id)->first(['id', 'status', 'rack_id']),
        };

        if (!$row) return 'That location no longer exists.';
        if ((int) $row->status !== 1) return 'That location is not active — it cannot take stock.';

        if (in_array($slot, ['zone', 'rack'], true) && (int) $row->warehouse_id !== (int) $task->warehouse_id) {
            return "That {$slot} is in a different warehouse.";
        }

        return null;
    }

    private function nameLocation(string $slot, ?int $id, ?ScanDevice $device = null): ?string
    {
        if (!$id) return null;

        $scope = fn ($q) => $device ? $q->where('client_id', $device->client_id) : $q;

        if ($slot === 'zone') return $scope(DB::table('inventory_zones')->where('id', $id))->value('code');
        if ($slot === 'rack') return $scope(DB::table('inventory_racks')->where('id', $id))->value('code');

        $shelf = $scope(DB::table('inventory_shelves')->where('id', $id))->first(['rack_id', 'level_no']);
        if (!$shelf) return null;

        $rack = DB::table('inventory_racks')->where('id', $shelf->rack_id)->value('code');

        return ($rack ?: 'RC-???') . '-SH-' . str_pad((string) $shelf->level_no, 2, '0', STR_PAD_LEFT);
    }

    private function boxFlags(?SpiBox $box): array
    {
        $ids = collect((array) $box?->flags)
            ->map(fn ($v) => (int) $v)->filter()->unique()->values();

        if ($ids->isEmpty()) return [];

        return DB::table('inventory_product_flags')->whereIn('id', $ids)
            ->orderBy('id')->get(['id', 'flag_name', 'behaviour'])
            ->map(fn ($f) => ['id' => (int) $f->id, 'name' => $f->flag_name, 'behaviour' => $f->behaviour])
            ->all();
    }

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
                'batch_no'    => $i->batch_no,
                'lot_no'      => $i->lot_no,
                'serial_no'   => $i->serial_no,
                'cat_no'      => $i->cat_no,
                'expiry_date' => $i->expiry_date ? (string) $i->expiry_date : null,
                'remark'      => $i->remark,
            ];
        })->values()->all();
    }

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

    private function locationChildren(string $slot, int $id, ?int $clientId): array
    {
        if ($slot === 'rack') {
            $kids = DB::table('inventory_shelves')->where('rack_id', $id)
                ->orderBy('level_no')->get(['id', 'shelf_name', 'level_no', 'max_weight_kg', 'status']);
            $col = 'shelf_id';
        } elseif ($slot === 'zone') {
            if (DB::table('inventory_zones')->where('id', $id)->value('rack_mode') !== 'rack') return [];

            $kids = DB::table('inventory_racks')->where('zone_id', $id)
                ->orderBy('code')->get(['id', 'code', 'rack_name', 'status']);
            $col = 'rack_id';
        } else {
            return [];
        }

        if ($kids->isEmpty()) return [];

        $ids = $kids->pluck('id')->all();

        $due = $clientId
            ? SpiPutawayTask::where('client_id', $clientId)->open()->whereIn($col, $ids)
                ->with(['box:id,box_code', 'invoice:id,code'])->get()->groupBy($col)
            : collect();

        $held = DB::table('inventory_location_occupancy')
            ->whereIn($col, $ids)
            ->whereIn('status', [LocationOccupancy::RESERVED, LocationOccupancy::OCCUPIED])
            ->get(['occupant_id', 'box_code', 'weight_kg', 'status', $col])
            ->groupBy($col);

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
        $col = ['zone' => 'zone_id', 'rack' => 'rack_id', 'shelf' => 'shelf_id'][$slot] ?? 'shelf_id';

        $rows = DB::table('inventory_location_occupancy')
            ->where($col, $id)
            ->whereIn('status', [LocationOccupancy::RESERVED, LocationOccupancy::OCCUPIED])
            ->orderByDesc('id')
            ->get(['occupant_id', 'box_code', 'weight_kg', 'status', 'placed_at', 'reserved_at']);

        $cap = $slot === 'shelf'
            ? (float) DB::table('inventory_shelves')->where('id', $id)->value('max_weight_kg')
            : null;

        $used = (float) $rows->sum('weight_kg');

        return [
            'kind'     => $slot,
            'id'       => $id,
            'name'     => $name,
            'address'  => $this->addressOf($slot, $id) + ['code' => $name],
            'details'  => $this->locationDetails($slot, $id),
            'children' => $this->locationChildren($slot, $id, $clientId),
            'boxes'    => $rows->map(fn ($r) => [
                'box_id'    => (int) $r->occupant_id,
                'box_code'  => $r->box_code,
                'weight_kg' => $r->weight_kg !== null ? (float) $r->weight_kg : null,
                'status'    => $r->status,
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

    private function log2(ScanDevice $device, string $event, array $attrs): void
    {
        $this->activity->log(
            $event, 'device', (int) $device->id,
            (int) $device->client_id, null, $device->actorId(),
            array_merge(['device_id' => $device->id], $attrs),
            'device',
        );
    }

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
            'claimed'  => $device->enrolled_by !== null,
        ];
    }

    private function boxBody(SpiBox $box, ?string $spiCode): array
    {
        return [
            'id'              => (int) $box->id,
            'box_code'        => $box->box_code,
            'putaway_code'    => 'PUT-' . $box->box_code,
            'spi_code'        => $spiCode,
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
            'vol_weight_kg'   => $box->length_cm && $box->width_cm && $box->height_cm
                ? round(((float) $box->length_cm * (float) $box->width_cm * (float) $box->height_cm) / SpiBox::VOLUMETRIC_DIVISOR, 2)
                : null,
            'temp_min_c'      => $box->temp_min_c !== null ? (float) $box->temp_min_c : null,
            'temp_max_c'      => $box->temp_max_c !== null ? (float) $box->temp_max_c : null,
            'flags'           => $this->boxFlags($box),
            'dimensions_cm'   => $box->length_cm && $box->width_cm && $box->height_cm
                ? sprintf('%s x %s x %s', (float) $box->length_cm, (float) $box->width_cm, (float) $box->height_cm)
                : null,
            'products'        => $this->boxProducts($box),
        ];
    }

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
                'last_activity_at'   => optional($task->lastScanAt())->toIso8601String(),
                'idle_after_minutes' => (int) config('inventory.scan_stale_minutes', 5),
                'idle_seconds_left'  => $task->idleSecondsLeft(),
                'issued_at'          => optional($task->issued_at)->toIso8601String(),
                'expires_at'         => optional($task->expires_at)->toIso8601String(),
            ],
            'box' => $box ? $this->boxBody($box, $task->invoice?->code) : null,
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
