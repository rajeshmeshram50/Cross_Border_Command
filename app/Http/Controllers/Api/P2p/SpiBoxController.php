<?php

namespace App\Http\Controllers\Api\P2p;

use App\Http\Controllers\Controller;
use App\Models\P2p\SpiBox;
use App\Models\P2p\SpiBoxItem;
use App\Models\P2p\SupplierInvoice;
use App\Services\P2p\SupplierInvoiceService;
use Barryvdh\DomPDF\Facade\Pdf;
use chillerlan\QRCode\QRCode;
use chillerlan\QRCode\QROptions;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
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

    /**
     * GET /p2p/spi/{id}/boxes/next-codes?count=5
     *
     * The codes the packing screen is about to use, so it can label its rows
     * before anything is saved.
     *
     * PREVIEW ONLY. Nothing is reserved — two people packing the same invoice
     * are both shown B-003, and whoever saves first gets it. The code that
     * ends up in the database is the one store() allocates under a row lock,
     * and it is returned on the save, so the screen should take it from there
     * rather than trusting what it was shown.
     */
    public function nextCodes(Request $request, int $id)
    {
        try {
            DB::beginTransaction();

            $this->tenantUser($request);
            $spi = $this->findSpi($id);

            // Capped: this answers a packing screen, not a label print run.
            $f = $request->validate(['count' => ['nullable', 'integer', 'min:1', 'max:100']]);
            $count = (int) ($f['count'] ?? 1);

            $codes = $this->nextBoxCodes($spi->id, $count);

            DB::commit();

            return response()->json(['status' => true, 'data' => [
                'count'      => $count,
                'next_codes' => $codes,
                // True while no other save lands first.
                'preview'    => true,
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

            /* The invoice row is locked for the length of the allocation, so
               two people packing the same SPI queue instead of both reading
               the same highest number and colliding on the unique index. The
               PO and SPI codes are allocated the same way. */
            SupplierInvoice::whereKey($spi->id)->lockForUpdate()->first();

            $box = SpiBox::create(collect($data)->except('items')->all() + [
                'supplier_invoice_id' => $spi->id,
                // Sequential within the INVOICE, so three SPIs packed at once
                // never interleave their numbering. Allocated here, under the
                // lock — never taken from the request, whatever the preview
                // endpoint showed the screen.
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

            /* Nothing is renumbered. Deleting B-003 leaves a permanent gap:
               that label was printed, stuck on a carton and may already have
               been scanned, so no later box may answer to the code. Closing
               the gap also broke the unique index outright — the soft-deleted
               row still holds its box_code, so renaming B-004 to B-003 hit
               a constraint violation. */
            $rows = $this->svc->packingSummary($spi->id);

            DB::commit();

            return response()->json(['status' => true, 'data' => [
                'deleted_box_id'  => $boxId,
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

    /**
     * GET /p2p/spi/{id}/boxes/{box}/sticker/download — the label, as a PDF.
     *
     * 4x6in, the standard label stock. The QR carries the BOX CODE and nothing
     * else: that is the exact string the put-away scanner matches on, so a URL
     * or a json blob in it would break the scan.
     *
     * Downloading IS printing, so this stamps sticker_printed_at when it is
     * still null — the same lock the preview takes. Without it a label could be
     * on a carton while the code was still free to be renumbered, and the floor
     * would scan the wrong box.
     */
    public function downloadSticker(Request $request, int $id, int $boxId)
    {
        try {
            DB::beginTransaction();

            $this->tenantUser($request);
            $spi = $this->findSpi($id);
            $box = $this->findBox($id, $boxId);

            $box->load('items.invoiceItem');
            $spi->loadMissing('vendor:id,vendor_code,company_name,legal_name');

            if (!$box->sticker_printed_at) {
                $box->forceFill(['sticker_printed_at' => now()])->save();
                $this->svc->log($spi, 'sticker_printed', [
                    'box_id' => $box->id, 'new_value' => $box->box_code, 'stage' => 3,
                ]);
            }

            $pdf = Pdf::loadView('pdf.spi-box-sticker', $this->stickerData($spi, $box))
                // Points, because the blade is laid out in points: 4in x 6in.
                ->setPaper([0, 0, 288, 432]);

            DB::commit();

            return $pdf->download(str_replace('/', '-', $spi->code) . '-' . $box->box_code . '.pdf');
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    /* ══════════════════════════ HELPERS ══════════════════════════ */

    /** Everything the sticker blade renders, resolved once. */
    private function stickerData(SupplierInvoice $spi, SpiBox $box): array
    {
        $items = $box->items;

        // One product reads as itself; several read as a count, because the
        // carton has no single name.
        $first    = $items->first()?->invoiceItem?->description;
        $headline = $items->count() > 1
            ? $items->count() . ' products'
            : ($first ?: 'Mixed carton');

        // Capped: a sticker that spills onto page 2 is useless on a carton.
        $lines = $items->take(6)->map(fn ($i) => [
            'description' => Str::limit((string) ($i->invoiceItem?->description ?: '—'), 48),
            'batch'       => $i->batch_no ?: ($i->lot_no ?: '—'),
            'qty'         => rtrim(rtrim(number_format((float) $i->quantity, 3, '.', ''), '0'), '.'),
            'uom'         => $i->invoiceItem?->uom ?: '',
        ])->all();

        $dims = $box->length_cm && $box->width_cm && $box->height_cm
            ? sprintf('%s x %s x %s cm', (float) $box->length_cm, (float) $box->width_cm, (float) $box->height_cm)
            : null;

        return [
            'spi'           => $spi,
            'box'           => $box,
            'headline'      => $headline,
            'supplier'      => $spi->vendor?->legal_name ?: $spi->vendor?->company_name,
            'scenarioLabel' => match ($box->scenario) {
                's1'    => 'One product / one box',
                's2'    => 'One product / many boxes',
                's3'    => 'Many products / one box',
                default => (string) $box->scenario,
            },
            'lines'      => $lines,
            'hidden'     => max(0, $items->count() - 6),
            'totalQty'   => rtrim(rtrim(number_format((float) $items->sum('quantity'), 3, '.', ''), '0'), '.'),
            'volumetric' => $box->volumetricWeightKg(),
            'dims'       => $dims,
            'packedOn'   => $box->created_at?->format('d M Y'),
            'printedOn'  => now()->format('d M Y H:i'),
            /* The ID, not the code. A box id is unique across every invoice,
               client and branch; B-001 exists on almost every SPI, so a QR
               carrying the code cannot say which carton it is. The code is
               printed in text beside it for the human. */
            'qr'         => $this->qr((string) $box->id),
        ];
    }

    /** A base64 PNG dompdf can embed. Null when it cannot be built — the
     *  sticker still prints, with the code in text, rather than failing. */
    private function qr(?string $value): ?string
    {
        if (!$value) return null;

        try {
            return (new QRCode(new QROptions([
                'eccLevel'    => 3,        // H — a scuffed carton label still reads
                'scale'       => 6,
                'imageBase64' => true,
                'outputType'  => 'png',
            ])))->render($value);
        } catch (\Throwable) {
            return null;
        }
    }

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

    /**
     * B-001 … B-nnn, per invoice. A code is issued once and never again.
     *
     * withTrashed() is the whole point: the unique index on
     * (supplier_invoice_id, box_code) covers soft-deleted rows, so a deleted
     * B-004 still holds that code. Counting only live boxes would hand the
     * next carton B-004 again and the insert would fail on the constraint.
     *
     * Gaps are therefore permanent, and that is the correct behaviour: B-003
     * was printed, stuck on a carton and may have been scanned. Nothing else
     * may ever answer to that code.
     *
     * Three digits, not two, precisely because of those gaps: the sequence is
     * the highest ever issued, not the live count, so an invoice that packs and
     * repacks runs past 99 long before it holds 99 cartons.
     */
    private function nextBoxCode(int $spiId): string
    {
        return $this->nextBoxCodes($spiId, 1)[0];
    }

    /**
     * The next $count codes in sequence, as an array.
     *
     * One query whatever the count: the sequence is the highest number ever
     * issued on the invoice, so the codes after it are arithmetic, not lookups.
     */
    private function nextBoxCodes(int $spiId, int $count): array
    {
        $max = 0;
        // Matches the retired BOX-01 / BOX-001 forms as well as B-001, so a
        // renamed invoice keeps counting from where it left off.
        foreach (SpiBox::withTrashed()->where('supplier_invoice_id', $spiId)->pluck('box_code') as $code) {
            if (preg_match('/^B(?:OX)?-(\d+)$/', (string) $code, $m)) $max = max($max, (int) $m[1]);
        }

        $codes = [];
        for ($i = 1; $i <= $count; $i++) {
            $codes[] = sprintf('B-%03d', $max + $i);
        }

        return $codes;
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
