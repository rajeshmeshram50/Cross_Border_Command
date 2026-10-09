<?php

namespace App\Http\Controllers\Api\P2p;

use App\Http\Controllers\Api\P2p\Concerns\RunsInTransaction;
use App\Http\Controllers\Controller;
use App\Models\P2p\SpiBox;
use App\Models\P2p\SpiPutaway;
use App\Models\P2p\SpiScanLog;
use App\Models\P2p\SupplierInvoice;
use App\Services\P2p\SupplierInvoiceService;
use Illuminate\Http\JsonResponse;
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
    use RunsInTransaction;

    public function __construct(private SupplierInvoiceService $svc) {}

    private function ok($data, int $code = 200): JsonResponse
    {
        return response()->json(['status' => true, 'data' => $data], $code);
    }

    private function fail(string $message, int $code = 422, array $extra = []): JsonResponse
    {
        return response()->json(['status' => false, 'message' => $message] + $extra, $code);
    }

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
    public function index(Request $request, int $id): JsonResponse
    {
        $this->tenantUser($request);
        $spi  = $this->findSpi($id);
        $full = $this->isFullPutaway($spi->warehouse_id);

        $rows = SpiPutaway::where('supplier_invoice_id', $id)->with('box:id,box_code')->get()
            ->map(fn ($p) => $p->toArray() + [
                'box_code'         => $p->box?->box_code,
                'next_scan'        => $p->nextScan($full),
                'ready_to_confirm' => $p->isReadyToConfirm($full),
            ]);

        return $this->ok([
            'putaway_mode' => $full ? 'full' : 'summary',
            'rows'         => $rows,
            'progress'     => [
                'placed' => $rows->whereNotNull('confirmed_at')->count(),
                'total'  => SpiBox::where('supplier_invoice_id', $id)->count(),
            ],
        ]);
    }

    /* ══════════════════════════ WRITE ══════════════════════════ */

    /** PUT /p2p/spi/{id}/storage-type — step 1 of the screen: choose the warehouse. */
    public function setStorageType(Request $request, int $id): JsonResponse
    {
        $this->tenantUser($request);
        $spi = $this->findSpi($id);

        $data = $request->validate(['warehouse_id' => ['required', 'integer']]);

        $wh = DB::table('master_warehouse_master')->where('id', $data['warehouse_id'])->first();
        if (!$wh) return $this->fail('That warehouse does not exist.');
        if ($wh->status !== 'Active') return $this->fail("{$wh->wh_name} is inactive — pick another warehouse.");

        $this->inTransaction('set the storage type', function () use ($spi, $data, $wh) {
            $spi->forceFill(['warehouse_id' => $data['warehouse_id']])->save();
            $this->svc->log($spi, 'storage_type_set', ['new_value' => $wh->wh_name, 'stage' => 4]);
        });

        return $this->ok([
            'warehouse_id' => $wh->id,
            'wh_name'      => $wh->wh_name,
            'wh_type'      => $wh->wh_type,
            // A third party gets no rack or shelf allocation.
            'putaway_mode' => $wh->wh_type === 'Own Warehouse' ? 'full' : 'summary',
        ]);
    }

    /**
     * POST /p2p/spi/{id}/putaway/scan — one scan per call.
     *
     * POST, not PUT: each scan stamps its own timestamp, so it is not
     * idempotent. Every attempt is logged before anything is decided.
     */
    public function scan(Request $request, int $id): JsonResponse
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
        $box  = SpiBox::where('supplier_invoice_id', $id)
            ->where('box_code', $data['box_code'] ?? $data['scanned_value'])->first();

        // ── Refusals. Each one is logged with the reason before it returns. ──

        if ($data['scan_type'] === 'box' && !$box) {
            $other = SpiBox::withoutGlobalScope('tenant')->where('box_code', $data['scanned_value'])->first();

            return $this->refuse($spi, $data, $user,
                $other ? 'wrong_spi' : 'unknown_code',
                $other ? "{$data['scanned_value']} belongs to another invoice." : "No box matches {$data['scanned_value']}.");
        }

        if (!$box) {
            return $this->refuse($spi, $data, $user, 'no_spi_context', 'Scan the box before anything else.');
        }

        $row  = SpiPutaway::firstOrNew(['box_id' => $box->id]);
        $next = $row->exists ? $row->nextScan($full) : 'box';

        if ($row->isPlaced()) {
            return $this->refuse($spi, $data, $user, 'already_placed', "{$box->box_code} is already put away.", $box, $row);
        }

        if ($next !== $data['scan_type']) {
            return $this->refuse($spi, $data, $user, 'out_of_order',
                'Scan the ' . ($next ?? 'nothing — the chain is complete') . ' before the ' . $data['scan_type'] . '.',
                $box, $row, $next);
        }

        // ── Accepted ──

        $row = $this->inTransaction('record the scan', function () use ($spi, $box, $row, $data, $user, $full) {
            $row->fill([
                'supplier_invoice_id' => $spi->id,
                'box_id'              => $box->id,
                'warehouse_id'        => $spi->warehouse_id,
                'device_serial'       => $data['device_serial'] ?? null,
                'scanned_by'          => $user->id,
                $data['scan_type'] . '_scanned_at' => now(),
            ])->save();

            $this->logScan($spi, $data, $user, 'success', null, null, $box, $row);
            $this->svc->log($spi, $data['scan_type'] . '_scanned', [
                'box_id' => $box->id, 'new_value' => $data['scanned_value'], 'stage' => 4,
            ]);

            return $row->refresh();
        });

        return $this->ok($row->toArray() + [
            'box_code'         => $box->box_code,
            'next_scan'        => $row->nextScan($full),
            'ready_to_confirm' => $row->isReadyToConfirm($full),
        ]);
    }

    /** PUT /p2p/spi/{id}/putaway/{row}/confirm — the box is now placed. */
    public function confirm(Request $request, int $id, int $rowId): JsonResponse
    {
        $user = $this->tenantUser($request);
        $spi  = $this->findSpi($id);
        $row  = SpiPutaway::where('supplier_invoice_id', $id)->with('box:id,box_code')->findOrFail($rowId);

        $full = $this->isFullPutaway($spi->warehouse_id);
        if (!$row->isReadyToConfirm($full)) {
            return $this->fail('Scan the ' . $row->nextScan($full) . " before confirming {$row->box?->box_code}.");
        }

        $data = $request->validate([
            'condition_at_putaway' => ['nullable', Rule::in(SpiPutaway::CONDITIONS)],
            'note'                 => ['nullable', 'string'],
        ]);

        $row = $this->inTransaction('confirm the put-away', function () use ($spi, $row, $data, $user) {
            $row->forceFill([
                'confirmed_at'         => now(),
                'confirmed_by'         => $user->id,
                'condition_at_putaway' => $data['condition_at_putaway'] ?? null,
            ])->save();

            $this->svc->log($spi, 'putaway_confirmed', [
                'box_id' => $row->box_id, 'new_value' => $row->destination,
                'note'   => $data['note'] ?? null, 'stage' => 4,
            ]);

            return $row->refresh();
        });

        $total  = SpiBox::where('supplier_invoice_id', $id)->count();
        $placed = SpiPutaway::where('supplier_invoice_id', $id)->whereNotNull('confirmed_at')->count();

        return $this->ok($row->toArray() + [
            'box_code' => $row->box?->box_code,
            'spi_putaway_progress' => ['placed' => $placed, 'total' => $total, 'complete' => $placed >= $total],
        ]);
    }

    /* ══════════════════════════ SCAN LOG ══════════════════════════ */

    /** Log the rejection, then return it. The log row is the point. */
    private function refuse(
        SupplierInvoice $spi, array $data, $user, string $reason, string $message,
        ?SpiBox $box = null, ?SpiPutaway $row = null, ?string $expected = null
    ): JsonResponse {
        $this->logScan($spi, $data, $user, 'failed', $reason, $message, $box, $row, $expected);

        return $this->fail($message);
    }

    private function logScan(
        SupplierInvoice $spi, array $data, $user, string $result,
        ?string $reason = null, ?string $message = null,
        ?SpiBox $box = null, ?SpiPutaway $row = null, ?string $expected = null
    ): void {
        SpiScanLog::create([
            'supplier_invoice_id' => $spi->id,
            'putaway_id'          => $row?->id,
            'box_id'              => $box?->id,
            'scan_type'           => $data['scan_type'],
            // The raw string the scanner reported, kept even when unreadable —
            // that string is the evidence.
            'scanned_value'       => $data['scanned_value'],
            'resolved_id'         => $box?->id,
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
