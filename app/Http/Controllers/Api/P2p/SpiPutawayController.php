<?php

namespace App\Http\Controllers\Api\P2p;

use App\Http\Controllers\Controller;
use App\Models\P2p\SpiBox;
use App\Models\P2p\SpiPutaway;
use App\Models\P2p\SpiScanLog;
use App\Models\P2p\SupplierInvoice;
use App\Services\P2p\SupplierInvoiceService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * P2P · SPI Stage 04 — temporary put-away. /api/p2p/spi/{id}/putaway
 *
 * The operator scans a chain: box -> location -> rack -> shelf, then confirms.
 * Until confirmed the box is PICKED BUT NOT PLACED.
 *
 * Every attempt is written to p2p_spi_scan_logs, success and failure alike. A
 * rejected scan never touches the put-away row, so without that log it would
 * be invisible — and "the scanner isn't working" would be unanswerable.
 *
 * An own warehouse allocates rack and shelf; a third party is summary only.
 * Which it is comes from master_warehouse_master.wh_type, never from a column
 * here that could contradict it.
 */
class SpiPutawayController extends Controller
{
    public function __construct(private SupplierInvoiceService $svc) {}

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

    /** True when the chosen warehouse is ours, so rack and shelf are allocated. */
    private function isFullPutaway(?int $warehouseId): bool
    {
        if (!$warehouseId) return true;

        return DB::table('master_warehouse_master')->where('id', $warehouseId)->value('wh_type') === 'Own Warehouse';
    }

    /* ══════════════════════════ READ ══════════════════════════ */

    /** GET /p2p/spi/{id}/putaway */
    public function index(Request $request, int $id)
    {
        try {
            DB::beginTransaction();

            $this->tenantUser($request);
            $spi  = $this->findSpi($id);
            $full = $this->isFullPutaway($spi->warehouse_id);

            $rows = SpiPutaway::where('supplier_invoice_id', $id)->with('box:id,box_code')->get()
                ->map(fn ($p) => $p->toArray() + [
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

    /* ══════════════════════════ WRITE ══════════════════════════ */

    /** PUT /p2p/spi/{id}/storage-type — step 1 of the screen: choose the warehouse. */
    public function setStorageType(Request $request, int $id)
    {
        try {
            DB::beginTransaction();

            $this->tenantUser($request);
            $spi  = $this->findSpi($id);
            $data = $request->validate(['warehouse_id' => ['required', 'integer']]);

            $wh = DB::table('master_warehouse_master')->where('id', $data['warehouse_id'])->first();
            if (!$wh) {
                abort(response()->json(['status' => false, 'message' => 'That warehouse does not exist.'], 422));
            }
            if ($wh->status !== 'Active') {
                abort(response()->json([
                    'status'  => false,
                    'message' => "{$wh->wh_name} is inactive — pick another warehouse.",
                ], 422));
            }

            $spi->forceFill(['warehouse_id' => $data['warehouse_id']])->save();
            $this->svc->log($spi, 'storage_type_set', ['new_value' => $wh->wh_name, 'stage' => 4]);

            DB::commit();

            return response()->json(['status' => true, 'data' => [
                'warehouse_id' => $wh->id,
                'wh_name'      => $wh->wh_name,
                'wh_type'      => $wh->wh_type,
                // A third party gets no rack or shelf allocation.
                'putaway_mode' => $wh->wh_type === 'Own Warehouse' ? 'full' : 'summary',
            ]], 200);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    /**
     * POST /p2p/spi/{id}/putaway/scan — one scan per call.
     *
     * POST, not PUT: each scan stamps its own timestamp, so it is not
     * idempotent. Every attempt is logged before anything is decided.
     *
     * The refusal checks run BEFORE the transaction opens, on purpose: a
     * refusal writes its scan-log row and then aborts, and a rollback would
     * destroy the one record the rejection exists to leave behind.
     */
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

        // ── Refusals. Each one is logged with the reason before it aborts. ──

        if ($data['scan_type'] === 'box' && !$box) {
            $value = $data['scanned_value'];

            $this->refuse($spi, $data, $user,
                $other ? 'wrong_spi' : 'unknown_code',
                $other
                    ? "{$value} is box {$other->box_code} on " . ($other->invoice?->code ?: 'another invoice') . '.'
                    : "No box matches {$value}.",
                null, null, null, $other?->id);
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
            $this->refuse($spi, $data, $user, 'out_of_order',
                'Scan the ' . ($next ?? 'nothing — the chain is complete') . ' before the ' . $data['scan_type'] . '.',
                $box, $row, $next);
        }

        /* Resolve WHERE the scan points, not just that it happened. Without
           this the row records four timestamps and no location, which is the
           one thing Stage 04 exists to capture. */
        $place = $this->resolveLocation($data['scan_type'], $data['scanned_value'], $spi, $row);
        if (is_string($place)) {
            $this->refuse($spi, $data, $user,
                $place === 'inactive' ? 'inactive_location' : ($place === 'not_on_rack' ? 'shelf_not_on_rack' : 'unknown_code'),
                match ($place) {
                    'inactive'    => "{$data['scanned_value']} is not active — pick another location.",
                    'not_on_rack' => "{$data['scanned_value']} is not on the rack you scanned.",
                    default       => "No {$data['scan_type']} matches {$data['scanned_value']}.",
                },
                $box, $row);
        }

        // ── Accepted ──

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
                'box_id' => $box->id, 'new_value' => $data['scanned_value'], 'stage' => 4,
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

    /** PUT /p2p/spi/{id}/putaway/{row}/confirm — the box is now placed. */
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
                'box_id' => $row->box_id, 'new_value' => $row->destination,
                'note'   => $data['note'] ?? null, 'stage' => 4,
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

    /**
     * The box a scan names, and — when it is not one of this invoice's — the
     * box it actually is, so the refusal can say which invoice to open.
     *
     * Resolved by ID first. A box id is unique across every invoice, client and
     * branch; a box CODE is only unique inside its own invoice, because every
     * invoice starts again at B-001. The sticker QR therefore carries the id,
     * and a numeric scan needs no invoice context at all.
     *
     * A textual scan is still accepted — someone keying the printed code by
     * hand — and that one is matched inside this invoice only.
     *
     * Both lookups go through the tenant scope, so a box of another client or
     * another branch is simply not found. The old version bypassed that scope
     * and searched everywhere, which made "belongs to another invoice" fire for
     * every typo once B-001 existed on more than one SPI.
     *
     * @return array{0: ?SpiBox, 1: ?SpiBox} the box on this invoice, the box scanned
     */
    private function resolveScannedBox(SupplierInvoice $spi, array $data): array
    {
        $value = trim((string) ($data['box_code'] ?? $data['scanned_value']));

        if ($value === '') return [null, null];

        if (ctype_digit($value)) {
            $box = SpiBox::with('invoice:id,code')->find((int) $value);

            return [(int) $box?->supplier_invoice_id === (int) $spi->id ? $box : null, $box];
        }

        $box = SpiBox::where('supplier_invoice_id', $spi->id)->where('box_code', $value)->first();
        if ($box) return [$box, $box];

        // The same code on another of this tenant's invoices — name it.
        return [null, SpiBox::with('invoice:id,code')->where('box_code', $value)->first()];
    }

    /**
     * Turn a scanned barcode into the id it names.
     *
     * Returns the columns to write, or a string naming why it was refused:
     * 'unknown' · 'inactive' · 'not_on_rack'.
     *
     * A box scan carries no location of its own, so it writes nothing here —
     * the box has already been resolved by the caller.
     */
    private function resolveLocation(string $type, string $value, SupplierInvoice $spi, SpiPutaway $row): array|string
    {
        if ($type === 'box') return [];

        if ($type === 'location') {
            // The zone within the invoice's warehouse.
            $zone = DB::table('master_zone_master')
                ->where('warehouse', (string) $spi->warehouse_id)
                ->where('zone_id', $value)->first();
            if (!$zone) return 'unknown';
            if (($zone->status ?? 'Active') !== 'Active') return 'inactive';

            return ['zone_id' => $zone->id];
        }

        if ($type === 'rack') {
            $rack = DB::table('master_racks')
                ->where('warehouse', (string) $spi->warehouse_id)
                ->where('rackName', $value)->first();
            if (!$rack) return 'unknown';
            // A rack in another zone than the one just scanned is a wrong turn.
            if ($row->zone_id && (string) $rack->zone !== (string) $row->zone_id) return 'not_on_rack';

            return ['rack_id' => $rack->id];
        }

        // shelf
        $shelf = DB::table('master_shelf_master')->where('shelf_name', $value)->first();
        if (!$shelf) return 'unknown';
        if (($shelf->status ?? 'Active') === 'Under Maintenance') return 'inactive';
        // The shelf must belong to the rack the operator just scanned.
        if ($row->rack_id && (string) $shelf->rack_ref !== (string) $row->rack_id) return 'not_on_rack';

        return ['shelf_id' => $shelf->id];
    }

    /** The human-readable placement, rebuilt after every scan. */
    private function describe(SpiPutaway $row): string
    {
        $wh    = DB::table('master_warehouse_master')->where('id', $row->warehouse_id)->value('wh_id');
        $zone  = $row->zone_id  ? DB::table('master_zone_master')->where('id', $row->zone_id)->value('zone_id') : null;
        $rack  = $row->rack_id  ? DB::table('master_racks')->where('id', $row->rack_id)->value('rackName') : null;
        $shelf = $row->shelf_id ? DB::table('master_shelf_master')->where('id', $row->shelf_id)->value('shelf_name') : null;

        return implode(' / ', array_filter([$wh, $zone, $rack, $shelf]));
    }

    /* ══════════════════════════ SCAN LOG ══════════════════════════ */

    /**
     * Log the rejection, then abort with it. The log row is the point, which
     * is why no transaction is open around the refusal path.
     */
    private function refuse(
        SupplierInvoice $spi, array $data, $user, string $reason, string $message,
        ?SpiBox $box = null, ?SpiPutaway $row = null, ?string $expected = null,
        ?int $resolvedId = null
    ): never {
        $this->logScan($spi, $data, $user, 'failed', $reason, $message, $box, $row, $expected, $resolvedId);

        abort(response()->json(['status' => false, 'message' => $message], 422));
    }

    /**
     * $resolvedId is what the scan actually named, which is not always a box of
     * THIS invoice — a carton from the next SPI resolves fine and is still
     * refused. box_id stays null in that case so the log cannot be read as if
     * the box belonged here, while resolved_id keeps the evidence.
     */
    private function logScan(
        SupplierInvoice $spi, array $data, $user, string $result,
        ?string $reason = null, ?string $message = null,
        ?SpiBox $box = null, ?SpiPutaway $row = null, ?string $expected = null,
        ?int $resolvedId = null
    ): void {
        SpiScanLog::create([
            'supplier_invoice_id' => $spi->id,
            'putaway_id'          => $row?->id,
            'box_id'              => $box?->id,
            'scan_type'           => $data['scan_type'],
            // The raw string the scanner reported, kept even when unreadable —
            // that string is the evidence.
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
