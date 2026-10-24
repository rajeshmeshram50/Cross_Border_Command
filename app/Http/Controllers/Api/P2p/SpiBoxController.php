<?php

namespace App\Http\Controllers\Api\P2p;

use App\Http\Controllers\Controller;
use App\Models\P2p\SpiBox;
use App\Models\P2p\SpiBoxAttachment;
use App\Models\P2p\SpiBoxItem;
use App\Models\P2p\SupplierInvoice;
use App\Services\Inventory\StickerKey;
use App\Services\P2p\SupplierInvoiceService;
use Barryvdh\DomPDF\Facade\Pdf;
use chillerlan\QRCode\Common\EccLevel;
use chillerlan\QRCode\Output\QRGdImagePNG;
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

            $data = $this->validateBox($request, (int) $user->client_id, (int) $spi->id, $spi->branch_id ? (int) $spi->branch_id : null);
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
            $this->storePhotos($request, $box, (int) $user->id);
            $this->svc->log($spi, 'box_created', ['box_id' => $box->id, 'new_value' => $box->box_code, 'stage' => 3]);

            $box->load(['items', 'attachments']);
            $rows = $this->svc->packingSummary($spi->id);
            $stage = $this->svc->syncPackingStage($spi);

            DB::commit();

            return response()->json(['status' => true, 'data' => [
                'box'             => $box->toArray() + ['volumetric_weight_kg' => $box->volumetricWeightKg()],
                'packing_summary' => $rows,
                'totals'          => $this->svc->packingTotals($rows),
                'stage_completed' => $stage,
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

            $user = $this->tenantUser($request);
            $spi = $this->findSpi($id);
            $box = $this->findBox($id, $boxId);

            if (!$spi->isEditable()) {
                abort(response()->json([
                    'status'  => false,
                    'message' => "{$spi->code} is {$spi->status} and can no longer be packed.",
                ], 422));
            }

            $data = $this->validateBox($request, (int) $user->client_id, (int) $spi->id, $spi->branch_id ? (int) $spi->branch_id : null);
            $this->guardOverPacking($spi, $data['items'], $box->id);

            $box->forceFill(collect($data)->except('items')->all())->save();

            // Contents are replaced wholesale — a partial update would leave
            // quantities from a product the user just removed.
            $box->items()->delete();
            $this->writeItems($box, $data['items']);

            /* Photos APPEND — contents above are replaced wholesale, but a
               re-save must not make the browser re-upload pictures it
               already sent. Removing one is its own DELETE. */
            $this->storePhotos($request, $box, (int) $user->id);

            $this->svc->log($spi, 'box_updated', ['box_id' => $box->id, 'new_value' => $box->box_code, 'stage' => 3]);

            $box->refresh()->load(['items', 'attachments']);
            $rows = $this->svc->packingSummary($spi->id);
            $stage = $this->svc->syncPackingStage($spi);

            DB::commit();

            return response()->json(['status' => true, 'data' => [
                'box'             => $box->toArray() + ['volumetric_weight_kg' => $box->volumetricWeightKg()],
                'packing_summary' => $rows,
                'totals'          => $this->svc->packingTotals($rows),
                'stage_completed' => $stage,
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
            // Removing a carton can un-finish stage 3 — the column follows.
            $stage = $this->svc->syncPackingStage($spi);

            DB::commit();

            return response()->json(['status' => true, 'data' => [
                'deleted_box_id'  => $boxId,
                'packing_summary' => $rows,
                'totals'          => $this->svc->packingTotals($rows),
                'stage_completed' => $stage,
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
     * 4x6in, the standard label stock. The QR carries the signed sticker URL
     * (see StickerKey) — the put-away scanner reads the id back out of it, and
     * the box code stays printed in text for whoever is reading the carton.
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

            $box->load(['items.invoiceItem', 'putaway']);
            $spi->loadMissing([
                'client:id,org_name',
                'vendor:id,vendor_code,company_name,legal_name',
                'purchaseOrder:id,code,po_date,procurement_request_code,created_at',
            ]);

            if (!$box->sticker_printed_at) {
                $box->forceFill(['sticker_printed_at' => now()])->save();
                $this->svc->log($spi, 'sticker_printed', [
                    'box_id' => $box->id, 'new_value' => $box->box_code, 'stage' => 3,
                ]);
            }

            $pdf = Pdf::loadView('pdf.spi-box-sticker', $this->stickerData($spi, $box))
                // A4 portrait. The blade is budgeted to ~775pt of the 841.9pt
                // sheet, one page — see its header before changing anything.
                ->setPaper("a4", "portrait");

            DB::commit();

            return $pdf->download(str_replace('/', '-', $spi->code) . '-' . $box->box_code . '.pdf');
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    /**
     * DELETE /p2p/spi/{id}/boxes/{box}/attachments/{attachment}
     *
     * Soft delete, and the file stays on disk: a packing photo is evidence
     * of the condition a carton arrived in, and a dispute can outlive the
     * row. Scoped through the box so one invoice cannot delete another's.
     */
    public function destroyAttachment(Request $request, int $id, int $boxId, int $attachmentId)
    {
        $this->tenantUser($request);
        $spi = $this->findSpi($id);
        $box = $this->findBox($id, $boxId);

        if (!$spi->isEditable()) {
            abort(response()->json([
                'status'  => false,
                'message' => "{$spi->code} is {$spi->status} and can no longer be packed.",
            ], 422));
        }

        $row = SpiBoxAttachment::where('box_id', $box->id)->find($attachmentId);
        if (!$row) {
            abort(response()->json(['status' => false, 'message' => 'No such attachment on this box.'], 404));
        }

        $row->delete();
        $this->svc->log($spi, 'box_updated', [
            'box_id' => $box->id, 'old_value' => $row->file_name, 'stage' => 3,
        ]);

        return response()->json(['status' => true, 'data' => $box->attachments()->get()], 200);
    }

    /* ══════════════════════════ HELPERS ══════════════════════════ */

    /**
     * Persist whatever came in as photos[] against this box.
     *
     * box_item_id stays NULL: the drawer photographs the CARTON, and the
     * model reads a null there as exactly that. Per-product shots are what
     * the column is for when a screen starts capturing them.
     *
     * The disk comes from config, never a literal — see
     * config/filesystems.php 'documents'. Hardcoding 'public' works today
     * only because that disk swaps its own driver for Azure; it would not
     * survive anyone pointing FILESYSTEM_DISK at s3.
     */
    private function storePhotos(Request $request, SpiBox $box, int $userId): int
    {
        $files = $request->file('photos');
        if (!$files) return 0;

        $request->validate([
            'photos'   => ['array', 'max:12'],
            'photos.*' => ['file', 'image', 'mimes:jpg,jpeg,png,webp', 'max:8192'],
        ]);

        $disk  = config('filesystems.documents');
        $dir   = "p2p/spi/{$box->supplier_invoice_id}/boxes/{$box->id}";
        $saved = 0;

        foreach ((array) $files as $file) {
            if (!$file || !$file->isValid()) continue;

            SpiBoxAttachment::create([
                'box_id'      => $box->id,
                'box_item_id' => null,
                'file_path'   => $file->store($dir, $disk),
                'file_name'   => $file->getClientOriginalName(),
                'uploaded_by' => $userId,
            ]);
            $saved++;
        }

        return $saved;
    }

    /** Everything the sticker blade renders, resolved once. */
    private function stickerData(SupplierInvoice $spi, SpiBox $box): array
    {
        $items = $box->items;
        $po    = $spi->purchaseOrder;

        $dims = $box->length_cm && $box->width_cm && $box->height_cm
            ? sprintf('%s x %s x %s', $this->num($box->length_cm), $this->num($box->width_cm), $this->num($box->height_cm))
            : null;

        /* The box's place in its invoice — "1 / 5" on the sticker. Ordered by
           code so the sequence a packer reads matches the sequence printed. */
        $codes = $spi->boxes()->orderBy('box_code')->pluck('box_code')->all();
        $seq   = array_search($box->box_code, $codes, true);

        $put = $box->putaway;

        return [
            'spi'   => $spi,
            'box'   => $box,
            'logo'  => $this->brandLogo(),
            'brand' => $spi->client?->org_name,

            /* A reprint is not the same label: the floor needs to know which
               copy it is holding when two are stuck to one carton. */
            'printNo'   => $this->printCount($box) + 1,
            'printedOn' => now()->format('d/m/Y H:i'),

            /* ── Business reference ──────────────────────────────────────
               Three codes, each with its date: where the demand came from,
               what was ordered against it, and what arrived. A domestic PO
               has no procurement request, so that slot degrades to a dash
               rather than vanishing — the label keeps one shape either way. */
            'refs' => [
                'procurement' => ['code' => $po?->procurement_request_code, 'date' => $this->day($po?->created_at)],
                'po'          => ['code' => $po?->code,                     'date' => $this->day($po?->po_date)],
                'spi'         => ['code' => $spi->code,                     'date' => $this->day($spi->invoice_date)],
            ],

            /* ── Box condition & product flags ───────────────────────────── */
            'putawayCode'   => 'PUT-' . $box->box_code,
            'scenarioLabel' => match ($box->scenario) {
                's1'    => '1 Product → 1 Box',
                's2'    => '1 Product → Multiple Boxes',
                's3'    => 'Multiple Products → 1 Box',
                default => (string) $box->scenario,
            },
            'boxQty'    => $this->num($items->sum('quantity')) . ' ' . ($items->first()?->invoiceItem?->uom ?: 'PCS'),
            'dims'      => $dims,
            'netWeight' => $box->net_weight_kg   ? $this->num($box->net_weight_kg) . ' kg'   : null,
            'grossWeight' => $box->gross_weight_kg ? $this->num($box->gross_weight_kg) . ' kg' : null,
            'conditionLabel' => match ($box->condition) {
                'perfect' => 'Perfect Condition',
                'minor'   => 'Minor Damage',
                'major'   => 'Major Damage',
                'severe'  => 'Severe Damage',
                default   => ucfirst((string) $box->condition),
            },
            'flags' => $this->boxFlags($box),

            /* ── Box location details ────────────────────────────────────── */
            'place' => $this->placement($put),

            /* ── Receiving check ────────────────────────────────────────── */
            'receiving' => $this->receiving($spi, $box),

            'boxNo'      => $seq === false ? 1 : $seq + 1,
            'totalBoxes' => count($codes) ?: 1,

            /* A signed URL, not bare text — the same payload the Inventory
               labels carry, so one scanner reads every label in the building.
               A stranger's camera OPENS it and meets "Device blocked"; a bare
               id would just be shown to them. Carries the box ID, because
               B-001 exists on almost every SPI. */
            'qr'    => $this->qr($url = StickerKey::url('BOX', $box->id, $spi->client_id)),
            'qrUrl' => $url,
        ];
    }

    /** Trailing zeros off a decimal column: 5.000 reads as 5, 5.600 as 5.6. */
    private function num($v): string
    {
        return rtrim(rtrim(number_format((float) $v, 3, '.', ''), '0'), '.') ?: '0';
    }

    private function day($v): ?string
    {
        if (!$v) return null;

        return ($v instanceof \DateTimeInterface ? \Carbon\Carbon::instance($v) : \Carbon\Carbon::parse($v))->format('d/m/Y');
    }

    /** Which copy of this label is being printed. */
    private function printCount(SpiBox $box): int
    {
        return (int) DB::table('p2p_spi_activities')
            ->where('box_id', $box->id)
            ->where('event', 'sticker_printed')
            ->count();
    }

    /**
     * Cold chain / hazardous / stacking, as the floor has to act on them.
     *
     * The flags live per ITEM, not per box, so the box carries a flag if any
     * item in it does — a carton with one hazardous product is a hazardous
     * carton. Stacking is the opposite: every item must allow it.
     */
    private function boxFlags(SpiBox $box): array
    {
        $ids = $box->items
            ->flatMap(fn ($i) => is_array($i->flags) ? $i->flags : (array) json_decode((string) $i->flags, true))
            ->filter()->unique()->values();

        $behaviours = $ids->isEmpty() ? collect() : DB::table('inventory_product_flags')
            ->whereIn('id', $ids)->pluck('behaviour');

        $cold = $behaviours->contains('cold_chain') || $box->temp_min_c !== null || $box->temp_max_c !== null;
        $temp = $box->temp_min_c !== null && $box->temp_max_c !== null
            ? sprintf('%s to %s °C', $this->num($box->temp_min_c), $this->num($box->temp_max_c))
            : null;

        $stackable = $box->is_stackable !== null
            ? (bool) $box->is_stackable
            : !$box->items->contains(fn ($i) => !$i->is_stackable);

        return [
            /* Named for what the storeman does with it, not for the flag that
               set it: a box with no cold-chain product still needs a shelf,
               and "No" told him nothing about which one. */
            'storage'   => $cold ? ('COLD CHAIN' . ($temp ? ' / ' . $temp : '')) : 'AMBIENT / NORMAL STORAGE',
            'hazardous' => $behaviours->contains('hazardous') ? 'Yes' : 'No',
            'stacking'  => $stackable ? 'Stackable' : 'Do Not Stack',
            'fragile'   => $behaviours->contains('fragile'),
        ];
    }

    /** The allocated location, named the way the Inventory labels name it. */
    private function placement($put): array
    {
        $empty = ['warehouse' => null, 'whName' => null, 'whType' => null, 'zone' => null,
                  'rack' => null, 'shelf' => null, 'path' => null, 'allocatedOn' => null];

        if (!$put || !$put->warehouse_id) return $empty;

        $wh   = DB::table('inventory_warehouses')->where('id', $put->warehouse_id)->first(['code', 'wh_name', 'wh_type']);
        $zone = $put->zone_id ? DB::table('inventory_zones')->where('id', $put->zone_id)->value('code') : null;
        $rack = $put->rack_id ? DB::table('inventory_racks')->where('id', $put->rack_id)->value('code') : null;

        // A shelf has no code column — it is its rack's code plus the level.
        $shelf = null;
        if ($put->shelf_id) {
            $level = DB::table('inventory_shelves')->where('id', $put->shelf_id)->value('level_no');
            $shelf = $level === null ? null : ($rack ?: 'RC-???') . '-SH-' . str_pad((string) $level, 2, '0', STR_PAD_LEFT);
        }

        return [
            'warehouse'   => $wh?->code,
            'whName'      => $wh?->wh_name,
            'whType'      => $wh?->wh_type ? strtoupper($wh->wh_type) : null,
            'zone'        => $zone,
            'rack'        => $rack,
            'shelf'       => $shelf,
            'path'        => implode(' / ', array_filter([$zone, $rack, $shelf])) ?: null,
            'allocatedOn' => $this->day($put->assigned_at ?: $put->created_at),
        ];
    }

    /**
     * What the gate recorded when this carton came in.
     *
     * There is no GRN table yet, so each line is derived from what packing
     * already wrote: when and by whom the box was raised, whether what was
     * packed tallies with the invoice, and the condition the packer set.
     * NEXT STAGE is fixed at GRN because that is the only stage after
     * put-away — revisit when the GRN module lands.
     */
    private function receiving(SupplierInvoice $spi, SpiBox $box): array
    {
        $by = $box->created_by
            ? DB::table('users')->where('id', $box->created_by)->value('employee_code')
            : null;

        /* Packed against invoiced, per line. Over-packing is the variance
           that matters — it means the carton holds stock the invoice never
           billed, which is what a GRN would reject. */
        $invoiced = $box->items->pluck('supplier_invoice_item_id')->filter()->unique();
        $matched  = true;
        if ($invoiced->isNotEmpty()) {
            $billed = DB::table('p2p_supplier_invoice_items')->whereIn('id', $invoiced)->pluck('qty_spi', 'id');
            foreach ($box->items as $i) {
                $cap = (float) ($billed[$i->supplier_invoice_item_id] ?? 0);
                if ($cap > 0 && (float) $i->quantity > $cap) { $matched = false; break; }
            }
        }

        return [
            'onDate'   => $this->day($box->created_at),
            'onTime'   => $box->created_at?->format('H:i'),
            'by'       => $by,
            'spiCheck' => $matched ? 'MATCHED' : 'VARIANCE',
            'physical' => $box->condition === 'perfect' ? 'NO DAMAGE' : strtoupper($this->conditionWord($box->condition)),
            'next'     => 'GRN',
        ];
    }

    private function conditionWord(?string $c): string
    {
        return match ($c) {
            'minor'  => 'Minor Damage',
            'major'  => 'Major Damage',
            'severe' => 'Severe Damage',
            default  => (string) $c,
        };
    }

    /** The printed brand mark, inlined because dompdf cannot fetch a URL. */
    private function brandLogo(): ?string
    {
        try {
            $path = public_path('images/igc-logo-invoice.png');

            return is_file($path)
                ? 'data:image/png;base64,' . base64_encode(file_get_contents($path))
                : null;
        } catch (\Throwable) {
            return null;
        }
    }

    /**
     * A base64 PNG dompdf can embed. Null when it cannot be built — the
     * sticker still prints, with the code in text, rather than failing.
     *
     * The option NAMES matter: php-qrcode v6 reads outputInterface and
     * outputBase64, and QROptions silently drops keys it does not know. The
     * v5 spelling ('outputType' => 'png', 'imageBase64' => true) therefore
     * produced an SVG, which dompdf cannot size — the sticker ran to three
     * pages until this was caught. If you change this, check the rendered
     * payload still starts with 'data:image/png'.
     *
     * Scale 6 is deliberate oversampling: 342px shown at 116pt is ~212 DPI,
     * which matches a thermal head. Rendering at display size instead would
     * halve that and the modules blur.
     */
    private function qr(?string $value): ?string
    {
        if (!$value) return null;

        try {
            return (new QRCode(new QROptions([
                'eccLevel'        => EccLevel::H,   // a scuffed carton label still reads
                'scale'           => 6,
                'outputInterface' => QRGdImagePNG::class,
                'outputBase64'    => true,
            ])))->render($value);
        } catch (\Throwable) {
            return null;
        }
    }

    private function validateBox(Request $request, int $clientId, int $spiId, ?int $branchId = null): array
    {
        $data = $request->validate($this->boxRules('', $clientId, $spiId, $branchId));
        $this->assertBoxConsistent($data, $clientId, $branchId);

        return $data;
    }

    /**
     * One box's rules.
     *
     * The ids are checked against the DATABASE, not just for being integers:
     * a payload may name any number it likes, and an invoice item from another
     * invoice or a flag from another tenant must fail here as a field error,
     * not reach the insert. Quantities are capped at 3 decimals because the
     * column is decimal(_,3) — Postgres would round 10.1234 silently and the
     * packed total would then never match what the packer typed.
     */
    private function boxRules(string $p = '', ?int $clientId = null, ?int $spiId = null, ?int $branchId = null): array
    {
        $itemExists = $spiId
            ? Rule::exists('p2p_supplier_invoice_items', 'id')
                ->where('supplier_invoice_id', $spiId)->whereNull('deleted_at')
            : 'integer';

        /* Scoped to the INVOICE'S branch, not just its client.
           Flag ids are per branch — branch 1's "Cold Chain" and branch 2's are
           different rows with different ids — while /product-flags/options
           answers for whichever branch the SWITCHER is on. Edit an invoice
           belonging to another branch and the screen resolves its Cold Chain
           chip to the wrong branch's id; stored unchecked, the box would carry
           a flag its own branch has never heard of, and the cold-chain guard
           below would not find it — so a range would be refused on a carton
           the packer did mark. Refused here instead, as a field error naming
           the flag. A row with a NULL branch is the client's own, shared by
           every branch, and stays valid. */
        $flagExists = $clientId
            ? Rule::exists('inventory_product_flags', 'id')
                // A null client is a platform default — Hazardous, Cold Chain,
                // Fragile — shared by everyone and valid on any box.
                ->where(fn ($q) => $q->where(fn ($w) => $w
                    ->whereNull('client_id')->orWhere('client_id', $clientId)))
                ->where(fn ($q) => $branchId
                    ? $q->where(fn ($w) => $w->whereNull('branch_id')->orWhere('branch_id', $branchId))
                    : $q)
            : 'integer';

        return [
            "{$p}scenario"        => ['required', Rule::in(SpiBox::SCENARIOS)],
            "{$p}length_cm"       => ['nullable', 'numeric', 'min:0', 'max:9999.99'],
            "{$p}width_cm"        => ['nullable', 'numeric', 'min:0', 'max:9999.99'],
            "{$p}height_cm"       => ['nullable', 'numeric', 'min:0', 'max:9999.99'],
            "{$p}weight_kg"       => ['nullable', 'numeric', 'min:0', 'max:999999.999'],
            "{$p}net_weight_kg"   => ['nullable', 'numeric', 'min:0', 'max:999999.999'],
            "{$p}gross_weight_kg" => ['nullable', 'numeric', 'min:0', 'max:999999.999'],
            "{$p}condition"       => ['required', Rule::in(SpiBox::CONDITIONS)],
            /* Whether another carton may sit on this one — a fact about the
               BOX. Accepted as 0/1 and stored as 0/1; absent means 0, because
               a crate nobody has vouched for is not one to put a pallet on. */
            "{$p}is_stackable"    => ['nullable', 'integer', Rule::in([0, 1])],

            /* Cold-chain range in °C. Floored at absolute zero because a
               typo'd minus sign is the only way to reach it, and capped at 100
               because a carton held above boiling is not a cold chain. */
            "{$p}temp_min_c"      => ['nullable', 'numeric', 'min:-273.15', 'max:100'],
            "{$p}temp_max_c"      => ['nullable', 'numeric', 'min:-273.15', 'max:100'],

            "{$p}items"                            => ['required', 'array', 'min:1', 'max:200'],
            "{$p}items.*.supplier_invoice_item_id" => ['required', 'integer', $itemExists],
            "{$p}items.*.quantity"                 => ['required', 'numeric', 'gt:0', 'decimal:0,3'],
            "{$p}items.*.is_stackable"             => ['nullable', 'boolean'],
            "{$p}items.*.remark"                   => ['nullable', Rule::in(SpiBoxItem::REMARKS)],
            "{$p}items.*.remark_note"              => ['nullable', 'string', 'max:500'],
            "{$p}items.*.flags"                    => ['nullable', 'array', 'max:20', function ($attribute, $value, $fail) {
                if (is_array($value) && count($value) !== count(array_unique(array_map('intval', $value)))) {
                    $fail('The same product flag is selected twice on one product.');
                }
            }],
            "{$p}items.*.flags.*"                  => ['integer', $flagExists],
            "{$p}items.*.serial_no"                => ['nullable', 'string', 'max:60'],
            "{$p}items.*.lot_no"                   => ['nullable', 'string', 'max:60'],
            "{$p}items.*.batch_no"                 => ['nullable', 'string', 'max:60'],
            "{$p}items.*.cat_no"                   => ['nullable', 'string', 'max:60'],
            "{$p}items.*.expiry_date"              => ['nullable', 'date'],
            "{$p}items.*.mfg_date"                 => ['nullable', 'date'],
        ];
    }

    /**
     * The rules a validator cannot state: they compare two fields of the same
     * box, or the box against its own contents.
     *
     * The key is returned beside the message so the form can highlight the
     * field, the way a validation failure does.
     */
    private function assertBoxConsistent(array $box, ?int $clientId = null, ?int $branchId = null): void
    {
        $fail = function (string $key, string $message) {
            abort(response()->json([
                'status'  => false,
                'message' => $message,
                'errors'  => [$key => [$message]],
            ], 422));
        };

        /* The scenario is not decoration: s1 and s2 are both ONE product in the
           box, s3 is the mixed carton. Stored unchecked, a box labelled s3 with
           a single line makes the Stage 03 counters and the packing list
           disagree with the cartons on the floor. */
        $products = collect($box['items'])->pluck('supplier_invoice_item_id')->unique()->count();

        if ($box['scenario'] === 's3' && $products < 2) {
            $fail('scenario', 'Scenario 03 is a mixed box — it needs at least two different products.');
        }
        if (in_array($box['scenario'], ['s1', 's2'], true) && $products > 1) {
            $fail('scenario', 'Scenario 01 and 02 hold one product per box. Use Scenario 03 for a mixed box.');
        }

        /* Volumetric weight is computed from all three dimensions, so two of
           them is not a smaller answer — it is no answer, and the label would
           print a blank where the freight figure belongs. */
        $dims = collect(['length_cm', 'width_cm', 'height_cm'])
            ->filter(fn ($k) => ($box[$k] ?? null) !== null && $box[$k] !== '');
        if ($dims->isNotEmpty() && $dims->count() < 3) {
            $fail('length_cm', 'Give all three dimensions, or none — volumetric weight needs length, width and height.');
        }

        $net   = $box['net_weight_kg'] ?? null;
        $gross = $box['gross_weight_kg'] ?? null;
        if ($net !== null && $gross !== null && (float) $net > (float) $gross + 0.001) {
            $fail('net_weight_kg', 'Net weight cannot be more than gross weight.');
        }

        /* A range needs both ends and the right way round. Half a range is
           not a weaker answer, it is an unusable one: put-away compares a box
           against a zone's own min and max, and a missing end makes the
           comparison impossible rather than approximate. */
        $tMin = $box['temp_min_c'] ?? null;
        $tMax = $box['temp_max_c'] ?? null;
        if (($tMin === null) !== ($tMax === null)) {
            $fail($tMin === null ? 'temp_min_c' : 'temp_max_c',
                'A temperature range needs both a minimum and a maximum.');
        }
        if ($tMin !== null && $tMax !== null && (float) $tMin > (float) $tMax) {
            $fail('temp_max_c', 'The maximum temperature cannot be below the minimum.');
        }

        /* A range only means something on a box marked Cold Chain. The flag is
           what says this carton is temperature-controlled at all; without it
           the numbers are two figures nobody will act on, and put-away would
           hold an ordinary carton to a range it was never meant to keep.
           Checked against the FLAG MASTER rather than a constant, because the
           ids are per tenant and the screen resolves the built-in chip to one
           by name. */
        if ($tMin !== null || $tMax !== null) {
            $onBox = collect($box['items'])->pluck('flags')->filter()->flatten()
                ->map(fn ($v) => (int) $v)->unique();

            if ($onBox->intersect($this->coldChainFlagIds($clientId, $branchId))->isEmpty()) {
                $fail('temp_min_c', 'Mark the box Cold Chain before setting a temperature range.');
            }
        }

        foreach ($box['items'] as $i => $row) {
            $line = "items.{$i}";

            // A damaged or mismatched line is a claim against the supplier. It
            // has to say what happened, or the vault holds a flag nobody can act on.
            $remark = $row['remark'] ?? null;
            if ($remark && $remark !== 'correct' && trim((string) ($row['remark_note'] ?? '')) === '') {
                $fail("{$line}.remark_note", "A '{$remark}' line needs a note saying what was found.");
            }

            $mfg    = $row['mfg_date'] ?? null;
            $expiry = $row['expiry_date'] ?? null;
            if ($mfg && $expiry && strtotime($expiry) <= strtotime($mfg)) {
                $fail("{$line}.expiry_date", 'Expiry date must be after the manufacturing date.');
            }
        }
    }

    /**
     * The tenant's Cold Chain flag ids, from the master.
     *
     * Matched on the NAME with spaces squeezed out — "Cold Chain", "cold
     * chain" and "ColdChain" are the same flag, and the screen already
     * resolves its built-in chip to a master row the same way. Returns an
     * empty list when the tenant has no such flag, which correctly refuses a
     * temperature range: a box cannot be cold chain if cold chain does not
     * exist to be selected.
     *
     * Memoised: one query per request however many boxes it carries.
     */
    private array $coldChainIds = [];

    private function coldChainFlagIds(?int $clientId, ?int $branchId = null): array
    {
        $key = ($clientId ?? 'null') . ':' . ($branchId ?? 'null');

        return $this->coldChainIds[$key] ??= DB::table('inventory_product_flags')
            /* Cold Chain is normally a PLATFORM row — client_id null, owned by
               nobody, one id for everyone — so a null client must stay valid
               here or the shared flag would never be found. A tenant that
               defined its own is accepted alongside it. */
            ->when($clientId, fn ($q) => $q->where(fn ($w) => $w
                ->whereNull('client_id')->orWhere('client_id', $clientId)))
            /* Same for the branch: a null branch_id row is shared across the
               client's branches, and a branch's own flag is checked too. */
            ->when($branchId, fn ($q) => $q->where(fn ($w) => $w
                ->where('branch_id', $branchId)->orWhereNull('branch_id')))
            ->whereRaw("lower(replace(flag_name, ' ', '')) = ?", ['coldchain'])
            ->pluck('id')
            ->map(fn ($v) => (int) $v)
            ->all();
    }

    private function writeItems(SpiBox $box, array $items): void
    {
        foreach ($items as $row) {
            $box->items()->create($row);
        }
    }

    /**
     * The next $count codes in sequence: B-001 … B-nnn, per invoice. A code is
     * issued once and never again.
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
     *
     * One query whatever the count, since the codes after the highest ever
     * issued are arithmetic, not lookups.
     */
    private function nextBoxCode(int $spiId): string
    {
        return $this->nextBoxCodes($spiId, 1)[0];
    }

    /** @see nextBoxCode() — the next $count codes in sequence, as an array. */
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
            if ($this->milli((float) $qty) > $this->milli($left)) {
                abort(response()->json([
                    'status'  => false,
                    'message' => 'Only ' . number_format($left, 3) . ' of that product is left to pack.',
                ], 422));
            }
        }
    }

    /**
     * A quantity as whole thousandths, for comparing two of them exactly.
     *
     * Both guards used to allow a 0.001 slack so that 0.1 + 0.2 reading as
     * 0.30000000000000004 would not refuse a legitimate exact fill. But the
     * slack is applied per line per box, so a trolley of fifty boxes could
     * over-pack by 0.05 and the invoice would sit at a negative pending — the
     * same silent over-supply the SPI balance was fixed for.
     *
     * Quantities are validated to three decimals and pending is rounded to
     * three, so scaling both sides to integers compares them exactly and needs
     * no slack at all.
     */
    private function milli(float $qty): int
    {
        return (int) round($qty * 1000);
    }
}
