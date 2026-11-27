<?php

namespace App\Http\Controllers\Api\P2p;

use App\Http\Controllers\Controller;
use App\Models\P2p\SpiBox;
use App\Models\P2p\SpiPutaway;
use App\Models\P2p\SpiScanLog;
use App\Models\P2p\SupplierInvoice;
use App\Services\Inventory\StickerKey;
use App\Services\Inventory\WarehouseCapabilityService;
use App\Services\P2p\SupplierInvoiceService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class SpiPutawayController extends Controller
{
    public function __construct(
        private SupplierInvoiceService $svc,
        private WarehouseCapabilityService $capability,
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

    private function isFullPutaway(?int $warehouseId): bool
    {
        if (!$warehouseId) return true;

        return DB::table('inventory_warehouses')->where('id', $warehouseId)->value('wh_type') === 'own';
    }

    public function index(Request $request, int $id)
    {
        try {
            DB::beginTransaction();

            $this->tenantUser($request);
            $spi  = $this->findSpi($id);
            $full = $this->isFullPutaway($spi->warehouse_id);

            $rows = SpiPutaway::where('supplier_invoice_id', $id)->with('box:id,box_code')->get()
                ->map(fn($p) => $p->toArray() + [
                    'box_code'         => $p->box?->box_code,
                    'next_scan'        => $p->nextScan($full),
                    'ready_to_confirm' => $p->isReadyToConfirm($full),
                ]);

            $body = [
                'putaway_mode' => $full ? 'full' : 'summary',
                'rows'         => $rows,
                'progress'     => [
                    'placed' => $rows->whereNotNull('confirmed_at')->count(),
                    'total'  => SpiBox::where('supplier_invoice_id', $id)->count(),
                ],
            ];

            DB::commit();

            return response()->json(['status' => true, 'data' => $body], 200);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    public function setStorageType(Request $request, int $id)
    {
        try {
            DB::beginTransaction();

            $this->tenantUser($request);
            $spi  = $this->findSpi($id);
            $data = $request->validate(['warehouse_id' => ['present', 'nullable', 'integer']]);

            if (!$spi->isEditable()) {
                abort(response()->json([
                    'status'  => false,
                    'message' => "{$spi->code} is {$spi->status} and can no longer be edited.",
                ], 422));
            }
            if ($spi->putaways()->exists()) {
                abort(response()->json([
                    'status'  => false,
                    'message' => "Putaway has already started for {$spi->code} — the warehouse can no longer be changed.",
                ], 422));
            }

            if ($data['warehouse_id'] === null) {
                $old = $spi->warehouse_id;
                $spi->forceFill(['warehouse_id' => null])->save();
                if ($old) $this->svc->log($spi, 'storage_type_set', ['new_value' => 'Third Party Warehouse', 'stage' => (int) $spi->stage_completed]);

                DB::commit();

                return response()->json(['status' => true, 'data' => [
                    'warehouse_id' => null,
                    'wh_name' => null,
                    'wh_type' => 'third_party',
                    'putaway_mode' => 'summary',
                ]], 200);
            }

            $wh = DB::table('inventory_warehouses')
                ->where('id', $data['warehouse_id'])
                ->where('client_id', $spi->client_id)
                ->where(fn($w) => $w->whereNull('branch_id')->orWhere('branch_id', $spi->branch_id))
                ->first();
            if (!$wh) {
                abort(response()->json(['status' => false, 'message' => 'That warehouse does not exist.'], 422));
            }
            if ((int) $wh->status !== 1) {
                abort(response()->json([
                    'status'  => false,
                    'message' => "{$wh->wh_name} is inactive — pick another warehouse.",
                ], 422));
            }

            $missing = $this->capability->missingFor($spi->id, (int) $wh->id);
            if ($missing) {
                abort(response()->json([
                    'status'                 => false,
                    'message'                => "{$wh->wh_name} has no " . implode(' and ', $missing)
                        . " — the boxes on {$spi->code} need it. Pick a warehouse that has it.",
                    'warehouse_incompatible' => true,
                    'missing'                => $missing,
                ], 422));
            }

            $spi->forceFill(['warehouse_id' => $data['warehouse_id']])->save();
            $this->svc->log($spi, 'storage_type_set', ['new_value' => $wh->wh_name, 'stage' => (int) $spi->stage_completed]);

            DB::commit();

            return response()->json(['status' => true, 'data' => [
                'warehouse_id' => $wh->id,
                'wh_name'      => $wh->wh_name,
                'wh_type'      => $wh->wh_type,
                'putaway_mode' => $this->isFullPutaway((int) $wh->id) ? 'full' : 'summary',
            ]], 200);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    public function warehouseEligibility(Request $request, int $id)
    {
        $this->tenantUser($request);
        $spi = $this->findSpi($id);

        $required = $this->capability->requiredFor($spi->id);

        $warehouseIds = DB::table('inventory_warehouses')
            ->where('client_id', $spi->client_id)
            ->where('wh_type', 'own')
            ->where('status', 1)
            ->where(fn ($w) => $w->whereNull('branch_id')->orWhere('branch_id', $spi->branch_id))
            ->pluck('id');

        $warehouses = [];
        foreach ($warehouseIds as $wid) {
            $have    = $this->capability->capabilitiesOf((int) $wid);
            $missing = $this->capability->missingGiven($required, (int) $wid);
            $warehouses[(string) $wid] = [
                'cold_chain' => $have['cold_chain'],
                'hazardous'  => $have['hazardous'],
                'compatible' => empty($missing),
                'missing'    => $missing,
            ];
        }

        return response()->json(['status' => true, 'data' => [
            'required'   => $required,
            'warehouses' => $warehouses,
        ]], 200);
    }

    public function scan(Request $request, int $id)
    {
        $user = $this->tenantUser($request);
        $spi  = $this->findSpi($id);

        $data = $request->validate([
            'scan_type'     => ['required', Rule::in(SpiPutaway::SCAN_TYPES)],
            'scanned_value' => ['required', 'string', 'max:120'],
            'box_code'      => ['nullable', 'string', 'max:40'],
            'device_serial' => ['nullable', 'string', 'max:64'],
            'latency_ms'    => ['nullable', 'integer'],
        ]);

        $full = $this->isFullPutaway($spi->warehouse_id);
        [$box, $other] = $this->resolveScannedBox($spi, $data);

        if ($data['scan_type'] === 'box' && !$box) {
            $value = $data['scanned_value'];

            $this->refuse(
                $spi,
                $data,
                $user,
                $other ? 'wrong_spi' : 'unknown_code',
                $other
                    ? "{$value} is box {$other->box_code} on " . ($other->invoice?->code ?: 'another invoice') . '.'
                    : "No box matches {$value}.",
                null,
                null,
                null,
                $other?->id
            );
        }

        if (!$box) {
            $this->refuse($spi, $data, $user, 'no_spi_context', 'Scan the box before anything else.');
        }

        $row  = SpiPutaway::firstOrNew(['box_id' => $box->id]);
        $next = $row->exists ? $row->nextScan($full) : 'box';

        if ($row->isPlaced()) {
            $this->refuse($spi, $data, $user, 'already_placed', "{$box->box_code} is already put away.", $box, $row);
        }

        if ($next !== $data['scan_type']) {
            $this->refuse(
                $spi,
                $data,
                $user,
                'out_of_order',
                'Scan the ' . ($next ?? 'nothing — the chain is complete') . ' before the ' . $data['scan_type'] . '.',
                $box,
                $row,
                $next
            );
        }

        $place = $this->resolveLocation($data['scan_type'], $data['scanned_value'], $spi, $row);
        if (is_string($place)) {
            $this->refuse(
                $spi,
                $data,
                $user,
                $place === 'inactive' ? 'inactive_location' : ($place === 'not_on_rack' ? 'shelf_not_on_rack' : 'unknown_code'),
                match ($place) {
                    'inactive'    => "{$data['scanned_value']} is not active — pick another location.",
                    'not_on_rack' => "{$data['scanned_value']} is not on the rack you scanned.",
                    default       => "No {$data['scan_type']} matches {$data['scanned_value']}.",
                },
                $box,
                $row
            );
        }

        try {
            DB::beginTransaction();

            $row->fill($place + [
                'supplier_invoice_id' => $spi->id,
                'box_id'              => $box->id,
                'warehouse_id'        => $spi->warehouse_id,
                'device_serial'       => $data['device_serial'] ?? null,
                'scanned_by'          => $user->id,
                $data['scan_type'] . '_scanned_at' => now(),
            ])->save();

            $row->forceFill(['destination' => $this->describe($row)])->save();

            $this->logScan($spi, $data, $user, 'success', null, null, $box, $row);
            $this->svc->log($spi, $data['scan_type'] . '_scanned', [
                'box_id' => $box->id,
                'new_value' => $data['scanned_value'],
                'stage' => 4,
            ]);

            $row->refresh();

            DB::commit();

            return response()->json(['status' => true, 'data' => $row->toArray() + [
                'box_code'         => $box->box_code,
                'next_scan'        => $row->nextScan($full),
                'ready_to_confirm' => $row->isReadyToConfirm($full),
            ]], 200);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    public function confirm(Request $request, int $id, int $rowId)
    {
        try {
            DB::beginTransaction();

            $user = $this->tenantUser($request);
            $spi  = $this->findSpi($id);
            $row  = SpiPutaway::where('supplier_invoice_id', $id)->with('box:id,box_code')->findOrFail($rowId);

            $full = $this->isFullPutaway($spi->warehouse_id);
            if (!$row->isReadyToConfirm($full)) {
                abort(response()->json([
                    'status'  => false,
                    'message' => 'Scan the ' . $row->nextScan($full) . " before confirming {$row->box?->box_code}.",
                ], 422));
            }

            $data = $request->validate([
                'condition_at_putaway' => ['nullable', Rule::in(SpiPutaway::CONDITIONS)],
                'note'                 => ['nullable', 'string'],
            ]);

            $row->forceFill([
                'confirmed_at'         => now(),
                'confirmed_by'         => $user->id,
                'condition_at_putaway' => $data['condition_at_putaway'] ?? null,
            ])->save();

            $this->svc->log($spi, 'putaway_confirmed', [
                'box_id' => $row->box_id,
                'new_value' => $row->destination,
                'note'   => $data['note'] ?? null,
                'stage' => 4,
            ]);

            $row->refresh();

            $total  = SpiBox::where('supplier_invoice_id', $id)->count();
            $placed = SpiPutaway::where('supplier_invoice_id', $id)->whereNotNull('confirmed_at')->count();

            DB::commit();

            return response()->json(['status' => true, 'data' => $row->toArray() + [
                'box_code'             => $row->box?->box_code,
                'spi_putaway_progress' => ['placed' => $placed, 'total' => $total, 'complete' => $placed >= $total],
            ]], 200);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    private function resolveScannedBox(SupplierInvoice $spi, array $data): array
    {
        $value = trim((string) ($data['box_code'] ?? $data['scanned_value']));

        if ($value === '') return [null, null];

        if ($id = StickerKey::idFor($value, 'BOX')) $value = (string) $id;

        if (ctype_digit($value)) {
            $box = SpiBox::with('invoice:id,code')->find((int) $value);

            return [(int) $box?->supplier_invoice_id === (int) $spi->id ? $box : null, $box];
        }

        $box = SpiBox::where('supplier_invoice_id', $spi->id)->where('box_code', $value)->first();
        if ($box) return [$box, $box];

        return [null, SpiBox::with('invoice:id,code')->where('box_code', $value)->first()];
    }

    private function resolveLocation(string $type, string $value, SupplierInvoice $spi, SpiPutaway $row): array|string
    {
        if ($type === 'box') return [];

        if ($type === 'location') {
            $zone = $this->matchLocation('inventory_zones', 'ZN', $value)
                ->where('warehouse_id', $spi->warehouse_id)->first();
            if (!$zone) return 'unknown';
            if ((int) $zone->status !== 1) return 'inactive';

            return ['zone_id' => $zone->id];
        }

        if ($type === 'rack') {
            $rack = $this->matchLocation('inventory_racks', 'RC', $value)
                ->where('warehouse_id', $spi->warehouse_id)->first();
            if (!$rack) return 'unknown';
            if ((int) $rack->status !== 1) return 'inactive';
            if ($row->zone_id && (int) $rack->zone_id !== (int) $row->zone_id) return 'not_on_rack';

            return ['rack_id' => $rack->id];
        }

        $shelf = $this->matchShelf($value, $row)->first();
        if (!$shelf) return 'unknown';
        if ((int) $shelf->status !== 1) return 'inactive';
        if ($row->rack_id && (int) $shelf->rack_id !== (int) $row->rack_id) return 'not_on_rack';

        return ['shelf_id' => $shelf->id];
    }

    private function describe(SpiPutaway $row): string
    {
        $wh   = DB::table('inventory_warehouses')->where('id', $row->warehouse_id)->value('code');
        $zone = $row->zone_id ? DB::table('inventory_zones')->where('id', $row->zone_id)->value('code') : null;
        $rack = $row->rack_id ? DB::table('inventory_racks')->where('id', $row->rack_id)->value('code') : null;

        $shelf = null;
        if ($row->shelf_id) {
            $level = DB::table('inventory_shelves')->where('id', $row->shelf_id)->value('level_no');
            $shelf = $level === null ? null : ($rack ?: 'RC-???') . '-SH-' . str_pad((string) $level, 2, '0', STR_PAD_LEFT);
        }

        return implode(' / ', array_filter([$wh, $zone, $rack, $shelf]));
    }

    private function matchLocation(string $table, string $kind, string $value)
    {
        $value = trim($value);
        $q     = DB::table($table);

        $type = ['ZN' => 'ZONE', 'RC' => 'RACK', 'SH' => 'SHELF', 'WH' => 'WAREHOUSE'][strtoupper($kind)] ?? '';
        if ($id = StickerKey::idFor($value, $type)) return $q->where('id', $id);

        return preg_match('/^' . $kind . ':(\d+)$/i', $value, $m)
            ? $q->where('id', (int) $m[1])
            : $q->where('code', 'ilike', $value);
    }

    private function matchShelf(string $value, SpiPutaway $row)
    {
        $value = trim($value);
        $q     = DB::table('inventory_shelves');

        if ($id = StickerKey::idFor($value, 'SHELF')) return $q->where('id', $id);

        if (preg_match('/^SH:(\d+)$/i', $value, $m)) {
            return $q->where('id', (int) $m[1]);
        }

        if (preg_match('/sh-?(\d+)$/i', $value, $m) && $row->rack_id) {
            return $q->where('rack_id', $row->rack_id)->where('level_no', (int) $m[1]);
        }

        return $q->where('shelf_name', 'ilike', $value);
    }

    private function refuse(
        SupplierInvoice $spi,
        array $data,
        $user,
        string $reason,
        string $message,
        ?SpiBox $box = null,
        ?SpiPutaway $row = null,
        ?string $expected = null,
        ?int $resolvedId = null
    ): never {
        $this->logScan($spi, $data, $user, 'failed', $reason, $message, $box, $row, $expected, $resolvedId);

        abort(response()->json(['status' => false, 'message' => $message], 422));
    }

    private function logScan(
        SupplierInvoice $spi,
        array $data,
        $user,
        string $result,
        ?string $reason = null,
        ?string $message = null,
        ?SpiBox $box = null,
        ?SpiPutaway $row = null,
        ?string $expected = null,
        ?int $resolvedId = null
    ): void {
        SpiScanLog::create([
            'supplier_invoice_id' => $spi->id,
            'putaway_id'          => $row?->id,
            'box_id'              => $box?->id,
            'scan_type'           => $data['scan_type'],
            'scanned_value'       => $data['scanned_value'],
            'resolved_id'         => $resolvedId ?? $box?->id,
            'result'              => $result,
            'failure_reason'      => $reason,
            'message'             => $message,
            'expected_scan'       => $expected,
            'device_serial'       => $data['device_serial'] ?? null,
            'scanned_by'          => $user->id,
            'latency_ms'          => $data['latency_ms'] ?? null,
            'scanned_at'          => now(),
        ]);
    }
}
