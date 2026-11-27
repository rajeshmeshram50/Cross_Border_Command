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
use App\Services\Inventory\LocationLockService;
use App\Services\Inventory\LocationOccupancyService;
use App\Services\Inventory\PutawayActivityLogger;
use App\Services\Inventory\StickerKey;
use App\Services\P2p\SupplierInvoiceService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

const PUTAWAY_REFUSALS = [
    'wrong_box'           => 'Wrong box for this task',
    'wrong_location'      => 'Wrong location for this task',
    'wrong_label_type'    => 'Wrong kind of label for this step',
    'already_scanned'     => 'Already scanned on this run',
    'already_placed'      => 'Box is already put away',
    'unknown_box'         => 'No box behind this sticker',
    'unknown_location'    => 'No location behind this label',
    'unreadable'          => 'Label could not be read',
    'bad_signature'       => 'Sticker signature did not verify',
    'box_not_packed'      => 'Box is not packed yet',
    'location_unusable'   => 'Location is inactive or in another warehouse',
    'no_task'             => 'No open task for this box',
    'device_wrong_client' => 'Device belongs to another client',
    'device_wrong_branch' => 'Device belongs to another branch',
    'inactive'            => 'Run dropped after sitting idle',
];

class SpiPutawayTaskController extends Controller
{
    public function __construct(
        private LocationOccupancyService $occupancy,
        private LocationLockService $locks,
        private PutawayActivityLogger $activity,
        private SupplierInvoiceService $svc,
    ) {}

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
            'is_open'    => $task->isOpen(),
            'is_done'    => $task->status === SpiPutawayTask::SCANNED,
        ]], 200);
    }

    public function activity(Request $request, int $taskId)
    {
        $user = $this->tenantUser($request);

        $task = SpiPutawayTask::where('client_id', $user->client_id)
            ->with(['box:id,box_code', 'invoice:id,code'])
            ->find($taskId);

        if (!$task) $this->missing("No put-away task found with id {$taskId}.");

        $log = PutawayActivityLog::where('task_id', $task->id)->orderBy('id')->get();

        $names = $log->pluck('actor_id')->filter()->unique();
        $names = $names->isEmpty() ? collect()
            : DB::table('users')->whereIn('id', $names)->pluck('name', 'id');

        $devs = $log->pluck('device_id')->filter()->unique();
        $devs = $devs->isEmpty() ? collect()
            : DB::table('scan_devices')->whereIn('id', $devs)->get(['id', 'serial', 'label'])->keyBy('id');

        $targets = $this->stickerTargets($log);

        $tries = [];

        $rows = $log->map(function (PutawayActivityLog $l) use ($names, $devs, $targets, &$tries) {
            $act = is_array($l->meta) ? ($l->meta['act'] ?? null) : null;
            $dev = $l->device_id ? $devs->get($l->device_id) : null;
            $val = is_array($l->meta) ? ($l->meta['value'] ?? null) : null;

            $try = null;
            if ($val !== null && $act === 'scan') {
                $id = $targets[$val]['key'] ?? $val;
                $tries[$id] = ($tries[$id] ?? 0) + 1;
                $try = $tries[$id];
            }

            return [
                'id'         => (int) $l->id,
                'at'         => optional($l->created_at)->toIso8601String(),
                'event'      => $l->event === 'putaway.released' ? PutawayActivityLog::RELEASED : $l->event,
                'ok'         => $l->event !== PutawayActivityLog::SCAN_FAILED,
                'kind'       => $act === 'stale_reset' ? 'stale_reset' : ($act === 'scan' ? 'scan' : 'lifecycle'),
                'reason'       => is_array($l->meta) ? ($l->meta['reason'] ?? null) : null,
                'reason_label' => $this->refusalLabel(is_array($l->meta) ? ($l->meta['reason'] ?? null) : null),
                'attempt'    => $try,
                'target'     => $val === null ? null : ($targets[$val] ?? null),
                'actor_type' => $l->actor_type,
                'actor_id'   => $l->actor_id ? (int) $l->actor_id : null,
                'actor'      => $l->actor_id ? $names->get($l->actor_id) : null,
                'device_id'  => $l->device_id ? (int) $l->device_id : null,
                'device'     => $dev ? ($dev->label ?: $dev->serial) : null,
                'device_serial' => $dev->serial ?? null,
                'meta'       => $l->meta,
                'to'         => $l->to_location,
            ];
        });

        $stickers = $this->stickerAttempts($rows);

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
            'stickers' => $stickers,
            'counts'   => [
                'total'  => $rows->count(),
                'passed' => $rows->where('kind', 'scan')->where('ok', true)->count(),
                'failed' => $rows->where('kind', 'scan')->where('ok', false)->count(),
                'resets' => $rows->where('kind', 'stale_reset')->count(),
                'labels' => count($stickers),
                'retried' => collect($stickers)->where('tries', '>', 1)->count(),
            ],
        ]], 200);
    }

    private function refusalLabel(?string $code): ?string
    {
        if ($code === null || $code === '') return null;

        return PUTAWAY_REFUSALS[$code] ?? ucfirst(str_replace('_', ' ', $code));
    }

    private function stickerTargets($log): array
    {
        $values = $log
            ->map(fn (PutawayActivityLog $l) => is_array($l->meta) ? ($l->meta['value'] ?? null) : null)
            ->filter()->unique()->values();

        if ($values->isEmpty()) return [];

        $kinds = ['BOX' => 'box', 'SHELF' => 'shelf', 'RACK' => 'rack', 'ZONE' => 'zone'];

        $parsed = [];
        foreach ($values as $v) {
            $hit  = StickerKey::parse((string) $v);
            $kind = $hit ? ($kinds[$hit['type']] ?? null) : null;

            $id = $hit && ctype_digit((string) $hit['id']) ? (int) $hit['id'] : null;

            $parsed[$v] = [
                'value'  => (string) $v,
                'key'    => $kind && $id ? "{$kind}:{$id}" : trim((string) $v),
                'kind'   => $kind,
                'id'     => $id,
                'signed' => (bool) $hit,
                'code'   => null,
            ];
        }

        $tables = [
            'box'   => ['p2p_spi_boxes', 'box_code'],
            'shelf' => ['inventory_shelves', 'code'],
            'rack'  => ['inventory_racks', 'code'],
            'zone'  => ['inventory_zones', 'code'],
        ];

        foreach ($tables as $kind => [$table, $col]) {
            $ids = collect($parsed)->where('kind', $kind)->pluck('id')->filter()->unique();
            if ($ids->isEmpty()) continue;

            $codes = DB::table($table)->whereIn('id', $ids->all())->pluck($col, 'id');

            foreach ($parsed as $v => $row) {
                if ($row['kind'] === $kind && $row['id']) {
                    $parsed[$v]['code'] = $codes[$row['id']] ?? null;
                }
            }
        }

        foreach ($parsed as $v => $row) {
            $parsed[$v]['label'] = $row['code']
                ? ucfirst((string) $row['kind']) . ' ' . $row['code']
                : ($row['kind'] ? ucfirst($row['kind']) . ' #' . ($row['id'] ?? '?') : 'Unreadable label');
        }

        return $parsed;
    }

    private function stickerAttempts($rows): array
    {
        $out = [];

        foreach ($rows as $r) {
            if ($r['kind'] !== 'scan' || !$r['target']) continue;

            $key = $r['target']['key'] ?? $r['target']['value'];

            $out[$key] ??= [
                'value'    => $r['target']['value'],
                'kind'     => $r['target']['kind'],
                'id'       => $r['target']['id'],
                'code'     => $r['target']['code'],
                'label'    => $r['target']['label'],
                'tries'    => 0,
                'passed'   => 0,
                'failed'   => 0,
                'reasons'  => [],
                'first_at' => $r['at'],
                'last_at'  => $r['at'],
                'devices'  => [],
                'accepted' => false,
            ];

            $out[$key]['value'] = $r['target']['value'];
            $out[$key]['tries']++;
            $out[$key][$r['ok'] ? 'passed' : 'failed']++;
            $out[$key]['last_at'] = $r['at'];
            $out[$key]['accepted'] = (bool) $r['ok'];

            if (!$r['ok'] && $r['reason']) {
                $out[$key]['reasons'][$r['reason']] = ($out[$key]['reasons'][$r['reason']] ?? 0) + 1;
            }

            if ($r['device'] && !in_array($r['device'], $out[$key]['devices'], true)) {
                $out[$key]['devices'][] = $r['device'];
            }
        }

        foreach ($out as $key => $row) {
            arsort($row['reasons']);
            $out[$key]['reasons'] = collect($row['reasons'])
                ->map(fn ($n, $code) => ['code' => $code, 'label' => $this->refusalLabel($code), 'count' => $n])
                ->values()->all();
        }

        return collect($out)->sortByDesc('failed')->values()->all();
    }

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
                $row->forceFill(['status' => SpiPutaway::DRAFT, 'task_id' => null])->save();
            }

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

    private function reservedPct(LocationOccupancy $occ): ?float
    {
        if (!$occ->shelf_id) return null;

        $cap = (float) DB::table('inventory_shelves')->where('id', $occ->shelf_id)->value('max_weight_kg');

        return $cap > 0 ? round((float) $occ->weight_kg / $cap * 100, 2) : null;
    }

    public function boxActivity(Request $request, int $id, int $boxId)
    {
        $user = $this->tenantUser($request);

        $box = SpiBox::where('supplier_invoice_id', $id)
            ->where('client_id', $user->client_id)
            ->find($boxId);
        if (!$box) $this->missing("No box {$boxId} on this invoice.");

        $log = PutawayActivityLog::where('client_id', $user->client_id)
            ->where('box_id', $box->id)
            ->orderBy('id')
            ->get();

        $names = $log->pluck('actor_id')->filter()->unique();
        $names = $names->isEmpty() ? collect()
            : DB::table('users')->whereIn('id', $names)->pluck('name', 'id');

        $devs = $log->pluck('device_id')->filter()->unique();
        $devs = $devs->isEmpty() ? collect()
            : DB::table('scan_devices')->whereIn('id', $devs)->get(['id', 'serial', 'label'])->keyBy('id');

        $timeline = $log->map(function (PutawayActivityLog $l) use ($names, $devs) {
            $dev  = $l->device_id ? $devs->get($l->device_id) : null;
            $meta = is_array($l->meta) ? $l->meta : [];
            return [
                'id'           => (int) $l->id,
                'at'           => optional($l->created_at)->toIso8601String(),
                'event'        => $l->event,
                'ok'           => $l->event !== PutawayActivityLog::SCAN_FAILED,
                'reason_label' => $this->refusalLabel($meta['reason'] ?? null),
                'slot'         => $meta['slot'] ?? null,
                'location'     => $this->locationText($l->to_location),
                'actor'        => $l->actor_id ? $names->get($l->actor_id) : null,
                'device'       => $dev ? ($dev->label ?: $dev->serial) : null,
            ];
        })->values();

        return response()->json(['status' => true, 'data' => [
            'box_code' => $box->box_code,
            'timeline' => $timeline,
        ]], 200);
    }

    private function locationText($snap): ?string
    {
        if (!is_array($snap)) return null;
        $shelf = $snap['shelf'] ?? null;
        $parts = array_filter([
            $snap['warehouse']['code'] ?? null,
            $snap['zone']['code'] ?? null,
            $snap['rack']['code'] ?? null,
            $shelf['level_no'] ?? null ? (($snap['rack']['code'] ?? 'RC') . '-SH-' . str_pad((string) $shelf['level_no'], 2, '0', STR_PAD_LEFT)) : null,
        ]);
        return $parts ? implode(' → ', $parts) : null;
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
