<?php

namespace App\Http\Controllers\Api\P2p;

use App\Http\Controllers\Controller;
use App\Models\P2p\SpiBox;
use App\Models\P2p\SpiBoxAttachment;
use App\Models\P2p\SpiBoxItem;
use App\Models\P2p\SupplierInvoice;
use App\Models\P2p\SupplierInvoiceItem;
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

    private function findBox(int $spiId, int $boxId): SpiBox
    {
        return SpiBox::where('supplier_invoice_id', $spiId)->findOrFail($boxId);
    }

    public function index(Request $request, int $id)
    {
        try {
            DB::beginTransaction();

            $this->tenantUser($request);
            $spi = $this->findSpi($id);

            $boxRows = $spi->boxes()->with(['items', 'attachments'])->orderBy('box_code')->get();

            /* supplier_invoice_item_id => uom_id, so each box item can carry
               the unit of the quantity it holds. The id only; `uoms` below
               holds the title. */
            $uomOfLine = collect($this->invoiceItemMap($boxRows))
                ->mapWithKeys(fn ($l) => [(int) $l['supplier_invoice_item_id'] => $l['uom_id']]);

            $boxes = $boxRows->map(function ($b) use ($uomOfLine) {
                $arr = $b->toArray();

                $arr['items'] = collect($arr['items'] ?? [])
                    ->map(fn ($i) => $i + [
                        'uom_id' => $uomOfLine[(int) ($i['supplier_invoice_item_id'] ?? 0)] ?? null,
                    ])
                    ->all();

                return $arr + ['volumetric_weight_kg' => $b->volumetricWeightKg()];
            });

            $rows = $this->svc->packingSummary($id);

            DB::commit();

            return response()->json(['status' => true, 'data' => [
                'boxes'           => $boxes,
                /* What each box item IS, keyed by the supplier_invoice_item_id
                   the items already carry. Additive: `boxes` keeps its exact
                   shape, so no existing caller can be broken by it. */
                'invoice_items'   => $this->invoiceItemMap($boxRows),
                // id => unit, joined from invoice_items[].uom_id
                'uoms'            => $this->uomMap($boxRows),
                // id => flag, for the ids on boxes[].items[].flags
                'flags'           => $this->flagMap($boxRows),
                'packing_summary' => $rows,
                'totals'          => $this->svc->packingTotals($rows) + ['boxes' => $boxes->count()],
            ]], 200);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    /**
     * GET /p2p/spi/{id}/boxes/{box} — one box, items and attachments.
     *
     * The same row index() returns, with the same `uom_id` on each item and
     * the same `invoice_items` / `uoms` maps beside it, so a caller reading
     * one box sees exactly what it would have seen in the list. What is left
     * out is what belongs to the invoice rather than the box: the packing
     * summary and the totals.
     */
    public function show(Request $request, int $id, int $boxId)
    {
        $this->tenantUser($request);
        $spi = $this->findSpi($id);

        /* Scoped through the invoice, not fetched by id and checked after:
           a box id from another tenant's invoice must read as missing. */
        $box = $spi->boxes()->with(['items', 'attachments'])->whereKey($boxId)->first();

        if (!$box) {
            return response()->json([
                'status'  => false,
                'message' => "No box {$boxId} on {$spi->code}.",
            ], 404);
        }

        $rows = collect([$box]);
        $uomOfLine = collect($this->invoiceItemMap($rows))
            ->mapWithKeys(fn ($l) => [(int) $l['supplier_invoice_item_id'] => $l['uom_id']]);

        $arr = $box->toArray();
        $arr['items'] = collect($arr['items'] ?? [])
            ->map(fn ($i) => $i + [
                'uom_id' => $uomOfLine[(int) ($i['supplier_invoice_item_id'] ?? 0)] ?? null,
            ])
            ->all();

        return response()->json(['status' => true, 'data' => [
            'box'           => $arr + ['volumetric_weight_kg' => $box->volumetricWeightKg()],
            'invoice_items' => $this->invoiceItemMap($rows),
            'uoms'          => $this->uomMap($rows),
            // id => flag, for the ids on box.items[].flags
            'flags'         => $this->flagMap($rows),
        ]], 200);
    }

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

                'totals' => $this->svc->packingTotals($rows) + [
                    'boxes' => SpiBox::where('supplier_invoice_id', $id)->count(),
                ],
            ]], 200);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    public function nextCodes(Request $request, int $id)
    {
        try {
            DB::beginTransaction();

            $this->tenantUser($request);
            $spi = $this->findSpi($id);

            $f = $request->validate(['count' => ['nullable', 'integer', 'min:1', 'max:100']]);
            $count = (int) ($f['count'] ?? 1);

            $codes = $this->nextBoxCodes($spi->id, $count);

            DB::commit();

            return response()->json(['status' => true, 'data' => [
                'count'      => $count,
                'next_codes' => $codes,

                'preview'    => true,
            ]], 200);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

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

            SupplierInvoice::whereKey($spi->id)->lockForUpdate()->first();

            $box = SpiBox::create(collect($data)->except(['items', 'flags'])->all() + [
                'flags'               => $this->boxFlagsFrom($data),
                'supplier_invoice_id' => $spi->id,

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

            $box->forceFill(collect($data)->except(['items', 'flags'])->all()
                + ['flags' => $this->boxFlagsFrom($data)])->save();

            $box->items()->delete();
            $this->writeItems($box, $data['items']);

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

    public function destroy(Request $request, int $id, int $boxId)
    {
        try {
            DB::beginTransaction();

            $this->tenantUser($request);
            $spi = $this->findSpi($id);
            $box = $this->findBox($id, $boxId);

            if ($box->putaway()->whereNotNull('confirmed_at')->exists()) {
                abort(response()->json([
                    'status'  => false,
                    'message' => "{$box->box_code} is already put away — remove it from its shelf before deleting the box.",
                ], 422));
            }

            $this->svc->log($spi, 'box_deleted', ['box_id' => $box->id, 'old_value' => $box->box_code, 'stage' => 3]);

            $box->items()->delete();
            $box->delete();

            $rows = $this->svc->packingSummary($spi->id);

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

                ->setPaper("a4", "portrait");

            DB::commit();

            return $pdf->download(str_replace('/', '-', $spi->code) . '-' . $box->box_code . '.pdf');
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

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

    /**
     * supplier_invoice_item_id => what that line actually is.
     *
     * TWO units come back, and they are not the same fact:
     *   uom      the string stored on the invoice line — what the screens
     *            print today, and what was agreed with the supplier
     *   uom_id   the product master's unit, with its title and short code
     *            resolved — the canonical one
     * They can disagree. The line's string is copied at invoicing and the
     * master can be edited afterwards, so a caller that shows the line's value
     * with the master's beside it can notice rather than guess.
     *
     * Two queries whatever the box count — the lines, then their products and
     * units. No boxes costs none.
     */
    private function invoiceItemMap($boxes): array
    {
        return $this->resolveLines($boxes)['items'];
    }

    /**
     * id => { title, short_code, unit_type } for every unit the boxes touch.
     *
     * Normalised out of invoice_items on purpose: a dozen lines on one
     * invoice commonly share two or three units, and the id is what joins
     * them. COALESCE(short_code, title) is the rule the PO-lines endpoint
     * prints by (PurchaseOrderController:1456), so a caller rendering
     * short_code with title as the fallback matches the existing screens.
     */
    private function uomMap($boxes): array
    {
        return $this->resolveLines($boxes)['uoms'];
    }

    /**
     * The handling flags these boxes refer to, keyed by id.
     *
     * Box items store flags as an array of ids. Only the ids in hand are
     * fetched: the master runs to dozens and a carton carries two, so
     * shipping the whole table to name a couple of them is the wrong trade.
     * Soft-deleted or disabled flags are still resolved — a box packed under
     * a flag that has since been retired must still say what it was packed
     * under.
     */
    private function flagMap($boxes): array
    {
        $ids = collect($boxes)
            ->flatMap(fn ($b) => (array) $b->flags)
            ->map(fn ($v) => (int) $v)->filter()->unique()->values();

        if ($ids->isEmpty()) return [];

        return DB::table('inventory_product_flags')
            ->whereIn('id', $ids)
            ->orderBy('id')
            ->get(['id', 'code', 'flag_name', 'purpose', 'behaviour', 'status'])
            ->keyBy('id')
            ->map(fn ($f) => [
                'id'        => (int) $f->id,
                'code'      => $f->code,
                'flag_name' => $f->flag_name,
                'purpose'   => $f->purpose,
                /* none | warn | block — what the floor must do about it. */
                'behaviour' => $f->behaviour,
                'is_active' => (int) $f->status === 1,
            ])
            ->all();
    }

    /** Both maps from one pass — memoised so a request resolves them once. */
    private array $linesCache = [];

    private function resolveLines($boxes): array
    {
        $key = spl_object_id($boxes);
        if (isset($this->linesCache[$key])) return $this->linesCache[$key];

        $built = $this->buildLineMaps($boxes);

        return $this->linesCache[$key] = $built;
    }

    private function buildLineMaps($boxes): array
    {
        $ids = $boxes
            ->flatMap(fn ($b) => $b->items->pluck('supplier_invoice_item_id'))
            ->filter()->unique()->values();

        if ($ids->isEmpty()) return ['items' => [], 'uoms' => []];

        $lines = SupplierInvoiceItem::whereIn('id', $ids)
            ->with([
                'product:id,product_code,name,generic_name,uom_id',
                'product.uom:id,title,short_code,unit_type',
            ])
            ->get(['id', 'supplier_invoice_id', 'line_no', 'product_id',
                   'description', 'hsn_code', 'uom', 'qty_spi', 'extra_qty']);

        $items = $lines->mapWithKeys(fn (SupplierInvoiceItem $l) => [
            (string) $l->id => [
                'supplier_invoice_item_id' => (int) $l->id,
                'line_no'        => $l->line_no === null ? null : (int) $l->line_no,
                'description'    => $l->description,
                'hsn_code'       => $l->hsn_code,
                'qty_spi'        => $l->qty_spi === null ? null : (float) $l->qty_spi,

                /* The line's own unit column. NULL on every row in this
                   database, kept so a caller can tell it was never set rather
                   than assume the product's unit was the invoiced one. */
                'uom'            => $l->uom,

                'product_id'     => $l->product_id === null ? null : (int) $l->product_id,
                'product_code'   => $l->product?->product_code,
                'product_name'   => $l->product?->name ?? $l->product?->generic_name,

                /* The id only. The unit itself is in the `uoms` object beside
                   this one — several lines usually share a unit, and repeating
                   its title on each of them is the same string three times. */
                'uom_id'         => $l->product?->uom_id === null ? null : (int) $l->product->uom_id,
            ],
        ])->all();

        $uoms = $lines
            ->map(fn (SupplierInvoiceItem $l) => $l->product?->uom)
            ->filter()
            ->unique('id')
            ->mapWithKeys(fn ($u) => [(string) $u->id => [
                'id'         => (int) $u->id,
                'title'      => $u->title,
                'short_code' => $u->short_code,
                'unit_type'  => $u->unit_type,
            ]])
            ->all();

        return ['items' => $items, 'uoms' => $uoms];
    }

    private function storePhotos(Request $request, SpiBox $box, int $userId): int
    {
        $files = $request->file('photos');
        if (!$files) return 0;

        $request->validate([
            'photos'   => ['array', 'max:12'],
            'photos.*' => ['file', 'image', 'mimes:jpg,jpeg,png,webp', 'max:8192'],
        ]);

        // See SupplierInvoiceController::storeAttachments — an empty disk
        // name reaches store() as a TypeError rather than a clean failure.
        $disk  = config('filesystems.documents') ?: config('filesystems.default', 'public');
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

    /**
     * Handling symbols for the row beside the QR.
     *
     * Line art, not glyphs: DejaVu's snowflake and warning characters render
     * at whatever weight the font gives them, which on a thermal head is
     * either invisible or a blob. These are strokes at a fixed width, and
     * they survive a scuffed label.
     *
     * Only what applies is returned, so the blade prints one tile, four, or
     * no row at all.
     */
    private function pictograms(array $flags): array
    {
        $out = [];

        if ($flags['cold']) {
            $out[] = [
                'svg'   => $this->svg($this->icoSnowflake()),
                'title' => 'COLD CHAIN',
                'sub'   => $flags['temp'] ? 'KEEP ' . $flags['temp'] : 'TEMPERATURE CONTROLLED',
            ];
        }

        if ($flags['hazardous'] === 'Yes') {
            $out[] = [
                'svg'   => $this->svg($this->icoHazard()),
                'title' => 'HAZARDOUS',
                'sub'   => $flags['hazClass'] ? 'CLASS ' . $flags['hazClass'] : 'CLASS N/A',
            ];
        }

        if (!empty($flags['fragile'])) {
            $out[] = [
                'svg'   => $this->svg($this->icoFragile()),
                'title' => 'FRAGILE',
                'sub'   => 'HANDLE WITH CARE',
            ];
        }

        if (($flags['stacking'] ?? '') === 'Do Not Stack') {
            $out[] = [
                'svg'   => $this->svg($this->icoNoStack()),
                'title' => 'DO NOT STACK',
                'sub'   => 'SINGLE TIER ONLY',
            ];
        }

        return $out;
    }

    /** dompdf takes SVG as an <img> data URI; inline <svg> is less reliable. */
    private function svg(string $body): string
    {
        $doc = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
             . '<rect x="3" y="3" width="94" height="94" rx="12" fill="#fff" stroke="#000" stroke-width="5"/>'
             . $body . '</svg>';

        return 'data:image/svg+xml;base64,' . base64_encode($doc);
    }

    /**
     * Six arms at 60°, each with a forked tip and one pair of branches
     * partway down — the shape a handler reads as "snowflake" rather than
     * "asterisk". Computed, not hand-placed: at six-fold symmetry a point
     * typed one unit out is visible as a wobble.
     */
    private function icoSnowflake(): string
    {
        $cx = 50; $cy = 50;
        $arm = 32;          // centre to tip
        $branchAt = [0.52, 0.80];
        $branchLen = 10;
        $branchAngle = 52;  // degrees off the arm, pointing outward

        $pt = function (float $deg, float $r) use ($cx, $cy) {
            $rad = deg2rad($deg);
            return [$cx + $r * cos($rad), $cy - $r * sin($rad)];
        };
        $line = fn (array $a, array $b) => sprintf(
            '<line x1="%.2f" y1="%.2f" x2="%.2f" y2="%.2f"/>', $a[0], $a[1], $b[0], $b[1]
        );

        $out = '';
        for ($i = 0; $i < 6; $i++) {
            $a = 90 + $i * 60;
            $tip = $pt($a, $arm);

            $out .= $line([$cx, $cy], $tip);

            foreach ($branchAt as $f) {
                $from = $pt($a, $arm * $f);
                foreach ([$branchAngle, -$branchAngle] as $off) {
                    // The branch grows OUT from the arm, so it is measured
                    // from the branch point, not from the centre.
                    $rad = deg2rad($a + $off);
                    $out .= $line($from, [
                        $from[0] + $branchLen * cos($rad),
                        $from[1] - $branchLen * sin($rad),
                    ]);
                }
            }
        }

        return '<g stroke="#000" stroke-width="4.2" stroke-linecap="round" fill="none">'
             . $out . '</g>';
    }
    private function icoHazard(): string
    {
        return '<polygon points="50,16 84,50 50,84 16,50" fill="none" stroke="#000" stroke-width="5"/>'
             . '<line x1="50" y1="34" x2="50" y2="57" stroke="#000" stroke-width="7" stroke-linecap="round"/>'
             . '<circle cx="50" cy="68" r="4" fill="#000"/>';
    }

    private function icoFragile(): string
    {
        return '<g stroke="#000" stroke-width="5" fill="none" stroke-linejoin="round">'
             . '<path d="M38 20 L62 20 L58 44 L52 50 L52 72 L62 72 L62 80 L38 80 L38 72 L48 72 L48 50 L42 44 Z"/>'
             . '</g>';
    }

    private function icoNoStack(): string
    {
        return '<g stroke="#000" stroke-width="5" fill="none">'
             . '<rect x="24" y="54" width="52" height="26"/>'
             . '<rect x="24" y="20" width="52" height="26"/>'
             . '<line x1="20" y1="76" x2="80" y2="24" stroke-width="6"/>'
             . '</g>';
    }

    /**
     * Every business reference the carton is traced by, each with its date.
     *
     * Own column first, then the order: a Direct SPI carries its own shipment
     * and procurement case and has no PO to read them from, and printing a
     * dash for a carton that IS against a case loses the only reference the
     * warehouse traces it by.
     */
    private function refs(SupplierInvoice $spi, $po): array
    {
        $spi->loadMissing([
            'shipmentOrder.lead:id,opp_code',
            'shipmentOrder.proformaInvoice:id,code,created_at,customer_id,consignee_id',
        ]);
        $po?->loadMissing([
            'shipmentOrder.lead:id,opp_code',
            'shipmentOrder.proformaInvoice:id,code,created_at,customer_id,consignee_id',
        ]);

        $shp  = $spi->shipmentOrder ?: $po?->shipmentOrder;
        $pi   = $shp?->proformaInvoice;
        $lead = $shp?->lead;

        return [
            'shp'  => ['code' => $shp?->shipment_code,  'date' => $this->day($shp?->created_at)],
            'opp'  => ['code' => $lead?->opp_code,      'date' => $this->day($lead?->created_at)],
            'proc' => [
                'code' => $spi->procurement_request_code ?? $po?->procurement_request_code,
                'date' => $this->day($po?->created_at ?? $spi->created_at),
            ],
            /* Inward Receipt Memo. Nothing in the system issues one yet, so it
               prints blank rather than borrowing another document's number. */
            'irm'  => ['code' => null,                  'date' => null],
            'inv'  => ['code' => $spi->invoice_no,      'date' => $this->day($spi->invoice_date)],
            'pi'   => ['code' => $pi?->code,            'date' => $this->day($pi?->created_at)],
            'po'   => ['code' => $po?->code,            'date' => $this->day($po?->po_date)],
            'spi'  => ['code' => $spi->code,            'date' => $this->day($spi->invoice_date)],
        ];
    }

    /** Who the carton is for and who it came from. */
    private function parties(SupplierInvoice $spi, $po): array
    {
        $pi = ($spi->shipmentOrder ?: $po?->shipmentOrder)?->proformaInvoice;

        return [
            'customer'  => $pi?->customer_id
                ? DB::table('customers')->where('id', $pi->customer_id)->value('customer_code')
                : null,
            'consignee' => $pi?->consignee_id
                ? DB::table('consignees')->where('id', $pi->consignee_id)->value('consignee_code')
                : null,
            'supplier'  => $spi->vendor?->vendor_code,
        ];
    }

    private function stickerData(SupplierInvoice $spi, SpiBox $box): array
    {
        $items = $box->items;
        $po    = $spi->purchaseOrder;

        $dims = $box->length_cm && $box->width_cm && $box->height_cm
            ? sprintf('%s x %s x %s', $this->num($box->length_cm), $this->num($box->width_cm), $this->num($box->height_cm))
            : null;

        $codes = $spi->boxes()->orderBy('box_code')->pluck('box_code')->all();
        $seq   = array_search($box->box_code, $codes, true);

        $put = $box->putaway;

        return [
            'spi'   => $spi,
            'box'   => $box,
            'logo'  => $this->brandLogo(),
            'brand' => $spi->client?->org_name,

            'printNo'   => $this->printCount($box) + 1,
            'printedOn' => now()->format('d/m/Y H:i'),

            'refs'    => $this->refs($spi, $po),
            'parties' => $this->parties($spi, $po),

            /* The prototype's face leads with the product and counts the
               rest — distinct PRODUCTS, not lines: one product split over
               two batches is still one thing in the box. */
            'productName'   => $items->first()?->invoiceItem?->product?->name
                            ?? $items->first()?->invoiceItem?->product?->generic_name,
            'moreProducts'  => max(0, $items->pluck('supplier_invoice_item_id')->unique()->count() - 1),

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
            'flags' => $flags = $this->boxFlags($box),
            'coldChain'   => $flags['cold'] ? 'Yes' . ($flags['temp'] ? ' (' . $flags['temp'] . ')' : '') : 'No',
            'hazardLabel' => $flags['hazardous'] . ' (Class: ' . ($flags['hazClass'] ?: 'N/A') . ')',
            /* Only the symbols that APPLY — a carton with neither prints none,
               one with both prints both. */
            'pictos'      => $this->pictograms($flags),

            'place' => $this->placement($put),

            'receiving' => $this->receiving($spi, $box),

            'boxNo'      => $seq === false ? 1 : $seq + 1,
            'totalBoxes' => count($codes) ?: 1,

            'qr'    => $this->qr($url = StickerKey::url('BOX', $box->id, $spi->client_id)),
            'qrUrl' => $url,
        ];
    }

    private function num($v): string
    {
        return rtrim(rtrim(number_format((float) $v, 3, '.', ''), '0'), '.') ?: '0';
    }

    private function day($v): ?string
    {
        if (!$v) return null;

        return ($v instanceof \DateTimeInterface ? \Carbon\Carbon::instance($v) : \Carbon\Carbon::parse($v))->format('d/m/Y');
    }

    private function printCount(SpiBox $box): int
    {
        return (int) DB::table('p2p_spi_activities')
            ->where('box_id', $box->id)
            ->where('event', 'sticker_printed')
            ->count();
    }

    private function boxFlags(SpiBox $box): array
    {
        $ids = collect((array) $box->flags)->map(fn ($v) => (int) $v)->filter()->unique()->values();

        $behaviours = $ids->isEmpty() ? collect() : DB::table('inventory_product_flags')
            ->whereIn('id', $ids)->pluck('behaviour');

        $rows = $ids->isEmpty() ? collect() : DB::table('inventory_product_flags')
            ->whereIn('id', $ids)->get(['behaviour', 'code', 'flag_name']);
        /* The hazard CLASS is the flag's own code — nothing else stores one. */
        $hazCode = $rows->firstWhere('behaviour', 'hazardous')?->code;

        $cold = $behaviours->contains('cold_chain') || $box->temp_min_c !== null || $box->temp_max_c !== null;
        $temp = $box->temp_min_c !== null && $box->temp_max_c !== null
            ? sprintf('%s to %s °C', $this->num($box->temp_min_c), $this->num($box->temp_max_c))
            : null;

        $stackable = $box->is_stackable !== null
            ? (bool) $box->is_stackable
            : !$box->items->contains(fn ($i) => !$i->is_stackable);

        return [

            'storage'   => $cold ? ('COLD CHAIN' . ($temp ? ' / ' . $temp : '')) : 'AMBIENT / NORMAL STORAGE',
            'hazardous' => $behaviours->contains('hazardous') ? 'Yes' : 'No',
            'hazClass'  => $hazCode,
            'temp'      => $temp,
            'cold'      => $cold,
            'stacking'  => $stackable ? 'Stackable' : 'Do Not Stack',
            'fragile'   => $behaviours->contains('fragile'),
        ];
    }

    private function placement($put): array
    {
        $empty = ['warehouse' => null, 'whName' => null, 'whType' => null, 'zone' => null,
                  'rack' => null, 'shelf' => null, 'path' => null, 'allocatedOn' => null];

        if (!$put || !$put->warehouse_id) return $empty;

        $wh   = DB::table('inventory_warehouses')->where('id', $put->warehouse_id)->first(['code', 'wh_name', 'wh_type']);
        $zone = $put->zone_id ? DB::table('inventory_zones')->where('id', $put->zone_id)->value('code') : null;
        $rack = $put->rack_id ? DB::table('inventory_racks')->where('id', $put->rack_id)->value('code') : null;

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

    private function receiving(SupplierInvoice $spi, SpiBox $box): array
    {
        $by = $box->created_by
            ? DB::table('users')->where('id', $box->created_by)->value('employee_code')
            : null;

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

    private function qr(?string $value): ?string
    {
        if (!$value) return null;

        try {
            return (new QRCode(new QROptions([
                'eccLevel'        => EccLevel::H,
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

    private function boxRules(string $p = '', ?int $clientId = null, ?int $spiId = null, ?int $branchId = null): array
    {
        $itemExists = $spiId
            ? Rule::exists('p2p_supplier_invoice_items', 'id')
                ->where('supplier_invoice_id', $spiId)->whereNull('deleted_at')
            : 'integer';

        $flagExists = $clientId
            ? Rule::exists('inventory_product_flags', 'id')

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

            "{$p}is_stackable"    => ['nullable', 'integer', Rule::in([0, 1])],

            "{$p}temp_min_c"      => ['nullable', 'numeric', 'min:-273.15', 'max:100'],
            "{$p}temp_max_c"      => ['nullable', 'numeric', 'min:-273.15', 'max:100'],

            "{$p}items"                            => ['required', 'array', 'min:1', 'max:200'],
            "{$p}items.*.supplier_invoice_item_id" => ['required', 'integer', $itemExists],
            "{$p}items.*.quantity"                 => ['required', 'numeric', 'gt:0', 'decimal:0,3'],
            "{$p}items.*.is_stackable"             => ['nullable', 'boolean'],
            "{$p}items.*.remark"                   => ['nullable', Rule::in(SpiBoxItem::REMARKS)],
            "{$p}items.*.remark_note"              => ['nullable', 'string', 'max:500'],
            /* Both shapes validate. The packing screen sends one list per
               ITEM (the same list on each); a caller may instead send one on
               the box. Either way the ids are checked here before boxFlagsFrom()
               decides which to keep. */
            "{$p}flags"                            => ['nullable', 'array', 'max:20'],
            "{$p}flags.*"                          => ['integer', $flagExists],
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

    private function assertBoxConsistent(array $box, ?int $clientId = null, ?int $branchId = null): void
    {
        $fail = function (string $key, string $message) {
            abort(response()->json([
                'status'  => false,
                'message' => $message,
                'errors'  => [$key => [$message]],
            ], 422));
        };

        $products = collect($box['items'])->pluck('supplier_invoice_item_id')->unique()->count();

        if ($box['scenario'] === 's3' && $products < 2) {
            $fail('scenario', 'Scenario 03 is a mixed box — it needs at least two different products.');
        }
        if (in_array($box['scenario'], ['s1', 's2'], true) && $products > 1) {
            $fail('scenario', 'Scenario 01 and 02 hold one product per box. Use Scenario 03 for a mixed box.');
        }

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

        $tMin = $box['temp_min_c'] ?? null;
        $tMax = $box['temp_max_c'] ?? null;
        if (($tMin === null) !== ($tMax === null)) {
            $fail($tMin === null ? 'temp_min_c' : 'temp_max_c',
                'A temperature range needs both a minimum and a maximum.');
        }
        if ($tMin !== null && $tMax !== null && (float) $tMin > (float) $tMax) {
            $fail('temp_max_c', 'The maximum temperature cannot be below the minimum.');
        }

        if ($tMin !== null || $tMax !== null) {
            $onBox = collect($this->boxFlagsFrom($box))->map(fn ($v) => (int) $v)->filter()->unique();

            if ($onBox->intersect($this->coldChainFlagIds($clientId, $branchId))->isEmpty()) {
                $fail('temp_min_c', 'Mark the box Cold Chain before setting a temperature range.');
            }
        }

        foreach ($box['items'] as $i => $row) {
            $line = "items.{$i}";

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

    private array $coldChainIds = [];

    private function coldChainFlagIds(?int $clientId, ?int $branchId = null): array
    {
        $key = ($clientId ?? 'null') . ':' . ($branchId ?? 'null');

        return $this->coldChainIds[$key] ??= DB::table('inventory_product_flags')

            ->when($clientId, fn ($q) => $q->where(fn ($w) => $w
                ->whereNull('client_id')->orWhere('client_id', $clientId)))

            ->when($branchId, fn ($q) => $q->where(fn ($w) => $w
                ->where('branch_id', $branchId)->orWhereNull('branch_id')))
            ->whereRaw("lower(replace(flag_name, ' ', '')) = ?", ['coldchain'])
            ->pluck('id')
            ->map(fn ($v) => (int) $v)
            ->all();
    }

    /**
     * The carton's flags, from whichever shape the caller sent.
     *
     * A box-level `flags` wins outright. Otherwise the union of the items'
     * copies — union rather than the first line's list, because nothing ever
     * forced the copies to match and dropping a flag someone set is worse
     * than carrying one they did not mean.
     */
    private function boxFlagsFrom(array $data): array
    {
        if (array_key_exists('flags', $data) && is_array($data['flags'])) {
            return collect($data['flags'])->map(fn ($v) => (int) $v)
                ->filter()->unique()->sort()->values()->all();
        }

        return collect($data['items'] ?? [])
            ->flatMap(fn ($i) => (array) ($i['flags'] ?? []))
            ->map(fn ($v) => (int) $v)
            ->filter()->unique()->sort()->values()->all();
    }

    private function writeItems(SpiBox $box, array $items): void
    {
        foreach ($items as $row) {
            /* The box holds the flags now. Leaving them on the line as well
               would be two copies free to drift, and the readers all ask the
               box. */
            unset($row['flags']);
            $box->items()->create($row);
        }
    }

    private function nextBoxCode(int $spiId): string
    {
        return $this->nextBoxCodes($spiId, 1)[0];
    }

    private function nextBoxCodes(int $spiId, int $count): array
    {
        $max = 0;

        foreach (SpiBox::withTrashed()->where('supplier_invoice_id', $spiId)->pluck('box_code') as $code) {
            if (preg_match('/^B(?:OX)?-(\d+)$/', (string) $code, $m)) $max = max($max, (int) $m[1]);
        }

        $codes = [];
        for ($i = 1; $i <= $count; $i++) {
            $codes[] = sprintf('B-%03d', $max + $i);
        }

        return $codes;
    }

    private function guardOverPacking(SupplierInvoice $spi, array $items, ?int $ignoreBoxId): void
    {
        $summary = collect($this->svc->packingSummary($spi->id))->keyBy('supplier_invoice_item_id');

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

    private function milli(float $qty): int
    {
        return (int) round($qty * 1000);
    }
}
