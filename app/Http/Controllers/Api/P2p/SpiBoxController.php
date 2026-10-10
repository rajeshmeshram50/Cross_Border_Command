<?php

namespace App\Http\Controllers\Api\P2p;

use App\Http\Controllers\Controller;
use App\Models\P2p\SpiBox;
use App\Models\P2p\SpiBoxItem;
use App\Models\P2p\SupplierInvoice;
use App\Services\P2p\SupplierInvoiceService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * P2P · SPI Stage 03 — box packaging. /api/p2p/spi/{id}/boxes
 *
 * A box and its contents save together, never apart: packed quantity is summed
 * from the contents, so a box saved without its items would read as empty.
 *
 * Every write returns the recomputed packing summary, so the "remaining"
 * table on screen needs no second request.
 */
class SpiBoxController extends Controller
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

    /** Scoped to the invoice so one SPI's id cannot reach another's box. */
    private function findBox(int $spiId, int $boxId): SpiBox
    {
        return SpiBox::where('supplier_invoice_id', $spiId)->findOrFail($boxId);
    }

    /* ══════════════════════════ READ ══════════════════════════ */

    /** GET /p2p/spi/{id}/boxes */
    public function index(Request $request, int $id)
    {
        try {
            DB::beginTransaction();

            $this->tenantUser($request);
            $spi = $this->findSpi($id);

            $boxes = $spi->boxes()->with('items')->orderBy('box_code')->get()
                ->map(fn ($b) => $b->toArray() + ['volumetric_weight_kg' => $b->volumetricWeightKg()]);

            $rows = $this->svc->packingSummary($id);

            DB::commit();

            return response()->json(['status' => true, 'data' => [
                'boxes'           => $boxes,
                'packing_summary' => $rows,
                'totals'          => $this->svc->packingTotals($rows) + ['boxes' => $boxes->count()],
            ]], 200);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    /** GET /p2p/spi/{id}/packing-summary — packed versus pending, per line. */
    public function packingSummary(Request $request, int $id)
    {
        try {
            DB::beginTransaction();

            $this->tenantUser($request);
            $this->findSpi($id);

            $rows = $this->svc->packingSummary($id);

            DB::commit();

            return response()->json(['status' => true, 'data' => [
                'items'  => $rows,
                // The TOTALS row under the grid.
                'totals' => $this->svc->packingTotals($rows) + [
                    'boxes' => SpiBox::where('supplier_invoice_id', $id)->count(),
                ],
            ]], 200);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    /* ══════════════════════════ WRITE ══════════════════════════ */

    /** POST /p2p/spi/{id}/boxes — the box and its contents in one payload. */
    public function store(Request $request, int $id)
    {
        try {
            DB::beginTransaction();

            $user = $this->tenantUser($request);
            $spi  = $this->findSpi($id);

            if (!$spi->isEditable()) {
                abort(response()->json([
                    'status'  => false,
                    'message' => "{$spi->code} is {$spi->status} and can no longer be packed.",
                ], 422));
            }

            $data = $this->validateBox($request);
            $this->guardOverPacking($spi, $data['items'], null);

            $box = SpiBox::create(collect($data)->except('items')->all() + [
                'supplier_invoice_id' => $spi->id,
                // Sequential within the INVOICE, so three SPIs packed at once
                // never interleave their numbering.
                'box_code'            => $this->nextBoxCode($spi->id),
                'created_by'          => $user->id,
            ]);

            $this->writeItems($box, $data['items']);
            $this->svc->log($spi, 'box_created', ['box_id' => $box->id, 'new_value' => $box->box_code, 'stage' => 3]);

            $box->load('items');
            $rows = $this->svc->packingSummary($spi->id);

            DB::commit();

            return response()->json(['status' => true, 'data' => [
                'box'             => $box->toArray() + ['volumetric_weight_kg' => $box->volumetricWeightKg()],
                'packing_summary' => $rows,
                'totals'          => $this->svc->packingTotals($rows),
            ]], 201);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    /** PUT /p2p/spi/{id}/boxes/{box} */
    public function update(Request $request, int $id, int $boxId)
    {
        try {
            DB::beginTransaction();

            $this->tenantUser($request);
            $spi = $this->findSpi($id);
            $box = $this->findBox($id, $boxId);

            if (!$spi->isEditable()) {
                abort(response()->json([
                    'status'  => false,
                    'message' => "{$spi->code} is {$spi->status} and can no longer be packed.",
                ], 422));
            }

            $data = $this->validateBox($request);
            $this->guardOverPacking($spi, $data['items'], $box->id);

            $box->forceFill(collect($data)->except('items')->all())->save();

            // Contents are replaced wholesale — a partial update would leave
            // quantities from a product the user just removed.
            $box->items()->delete();
            $this->writeItems($box, $data['items']);

            $this->svc->log($spi, 'box_updated', ['box_id' => $box->id, 'new_value' => $box->box_code, 'stage' => 3]);

            $box->refresh()->load('items');
            $rows = $this->svc->packingSummary($spi->id);

            DB::commit();

            return response()->json(['status' => true, 'data' => [
                'box'             => $box->toArray() + ['volumetric_weight_kg' => $box->volumetricWeightKg()],
                'packing_summary' => $rows,
                'totals'          => $this->svc->packingTotals($rows),
            ]], 200);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    /** DELETE /p2p/spi/{id}/boxes/{box} — soft delete; the quantity goes back to pending. */
    public function destroy(Request $request, int $id, int $boxId)
    {
        try {
            DB::beginTransaction();

            $this->tenantUser($request);
            $spi = $this->findSpi($id);
            $box = $this->findBox($id, $boxId);

            // A placed box is on a shelf being scanned — remove it from there first.
            if ($box->putaway()->whereNotNull('confirmed_at')->exists()) {
                abort(response()->json([
                    'status'  => false,
                    'message' => "{$box->box_code} is already put away — remove it from its shelf before deleting the box.",
                ], 422));
            }

            $this->svc->log($spi, 'box_deleted', ['box_id' => $box->id, 'old_value' => $box->box_code, 'stage' => 3]);

            $box->items()->delete();
            $box->delete();

            $renumbered = $this->renumber($spi->id);
            $rows       = $this->svc->packingSummary($spi->id);

            DB::commit();

            return response()->json(['status' => true, 'data' => [
                'deleted_box_id'  => $boxId,
                'renumbered'      => $renumbered,
                'packing_summary' => $rows,
                'totals'          => $this->svc->packingTotals($rows),
            ]], 200);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    /** POST /p2p/spi/{id}/boxes/{box}/sticker — printing freezes the box code. */
    public function printSticker(Request $request, int $id, int $boxId)
    {
        try {
            DB::beginTransaction();

            $this->tenantUser($request);
            $spi = $this->findSpi($id);
            $box = $this->findBox($id, $boxId);

            $box->forceFill(['sticker_printed_at' => now()])->save();
            $this->svc->log($spi, 'sticker_printed', ['box_id' => $box->id, 'new_value' => $box->box_code, 'stage' => 3]);

            $box->refresh()->load('items.invoiceItem');

            DB::commit();

            return response()->json(['status' => true, 'data' => [
                'box_code'           => $box->box_code,
                'sticker_printed_at' => $box->sticker_printed_at,
                // The signal to the UI that this box can no longer be renumbered.
                'code_locked'        => true,
                'payload'            => [
                    'spi_code'        => $spi->code,
                    'box_code'        => $box->box_code,
                    'gross_weight_kg' => $box->gross_weight_kg,
                    'products'        => $box->items->map(fn ($i) => [
                        'description' => $i->invoiceItem?->description,
                        'quantity'    => (float) $i->quantity,
                        'uom'         => $i->invoiceItem?->uom,
                    ]),
                ],
            ]], 200);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    /* ══════════════════════════ HELPERS ══════════════════════════ */

    private function validateBox(Request $request): array
    {
        return $request->validate([
            'scenario'        => ['required', Rule::in(SpiBox::SCENARIOS)],
            'length_cm'       => ['nullable', 'numeric', 'min:0'],
            'width_cm'        => ['nullable', 'numeric', 'min:0'],
            'height_cm'       => ['nullable', 'numeric', 'min:0'],
            'weight_kg'       => ['nullable', 'numeric', 'min:0'],
            'net_weight_kg'   => ['nullable', 'numeric', 'min:0'],
            'gross_weight_kg' => ['nullable', 'numeric', 'min:0'],
            'condition'       => ['required', Rule::in(SpiBox::CONDITIONS)],

            'items'                            => ['required', 'array', 'min:1'],
            'items.*.supplier_invoice_item_id' => ['required', 'integer'],
            'items.*.quantity'                 => ['required', 'numeric', 'gt:0'],
            'items.*.is_stackable'             => ['nullable', 'boolean'],
            'items.*.remark'                   => ['nullable', Rule::in(SpiBoxItem::REMARKS)],
            'items.*.remark_note'              => ['nullable', 'string'],
            'items.*.flags'                    => ['nullable', 'array'],
            'items.*.flags.*'                  => ['integer'],
            'items.*.serial_no'                => ['nullable', 'string', 'max:60'],
            'items.*.lot_no'                   => ['nullable', 'string', 'max:60'],
            'items.*.batch_no'                 => ['nullable', 'string', 'max:60'],
            'items.*.cat_no'                   => ['nullable', 'string', 'max:60'],
            'items.*.expiry_date'              => ['nullable', 'date'],
            'items.*.mfg_date'                 => ['nullable', 'date'],
        ]);
    }

    private function writeItems(SpiBox $box, array $items): void
    {
        foreach ($items as $row) {
            $box->items()->create($row);
        }
    }

    /** BOX-01 … BOX-n, per invoice. Trashed codes are skipped — they are free again. */
    private function nextBoxCode(int $spiId): string
    {
        $max = 0;
        foreach (SpiBox::where('supplier_invoice_id', $spiId)->pluck('box_code') as $code) {
            if (preg_match('/^BOX-(\d+)$/', (string) $code, $m)) $max = max($max, (int) $m[1]);
        }

        return sprintf('BOX-%02d', $max + 1);
    }

    /**
     * Close the gap a deleted box leaves — but only for boxes whose sticker has
     * not been printed. A printed label is physically on a carton being scanned
     * at put-away, so renaming it would point the floor at the wrong box.
     */
    private function renumber(int $spiId): array
    {
        $moved = [];
        $n = 0;

        foreach (SpiBox::where('supplier_invoice_id', $spiId)->orderBy('box_code')->get() as $box) {
            $n++;
            $want = sprintf('BOX-%02d', $n);
            if ($box->box_code === $want || $box->isCodeLocked()) continue;

            $moved[] = ['id' => $box->id, 'from' => $box->box_code, 'to' => $want];
            $box->forceFill(['box_code' => $want])->save();
        }

        return $moved;
    }

    /** Nothing may be packed beyond what the invoice says was billed. */
    private function guardOverPacking(SupplierInvoice $spi, array $items, ?int $ignoreBoxId): void
    {
        $summary = collect($this->svc->packingSummary($spi->id))->keyBy('supplier_invoice_item_id');

        // An edit re-sends the box's own contents, so its current rows must not
        // count against it.
        $own = $ignoreBoxId
            ? SpiBoxItem::where('box_id', $ignoreBoxId)->pluck('quantity', 'supplier_invoice_item_id')
            : collect();

        $wanted = collect($items)->groupBy('supplier_invoice_item_id')
            ->map(fn ($g) => collect($g)->sum('quantity'));

        foreach ($wanted as $itemId => $qty) {
            $row = $summary[$itemId] ?? null;
            if (!$row) {
                abort(response()->json([
                    'status'  => false,
                    'message' => 'That product is not on this invoice.',
                ], 422));
            }

            $left = $row['qty_pending'] + (float) ($own[$itemId] ?? 0);
            if ($qty > $left + 0.001) {
                abort(response()->json([
                    'status'  => false,
                    'message' => 'Only ' . number_format($left, 3) . ' of that product is left to pack.',
                ], 422));
            }
        }
    }
}
