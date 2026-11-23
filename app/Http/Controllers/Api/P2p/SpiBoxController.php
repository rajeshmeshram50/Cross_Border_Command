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
                'invoice_items'   => $this->invoiceItemMap($boxRows),
                'uoms'            => $this->uomMap($boxRows),
                'flags'           => $this->flagMap($boxRows),
                'packing_summary' => $rows,
                'totals'          => $this->svc->packingTotals($rows) + ['boxes' => $boxes->count()],
            ]], 200);
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }
    }

    public function show(Request $request, int $id, int $boxId)
    {
        $this->tenantUser($request);
        $spi = $this->findSpi($id);

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
            $this->svc->normaliseBoxScenarios($spi);

            $box->refresh()->load(['items', 'attachments']);
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
            $this->svc->normaliseBoxScenarios($spi);

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
            $this->svc->normaliseBoxScenarios($spi);

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
                'purchaseOrder:id,code,po_date,procurement_request_code,created_at,shipment_order_id,proforma_invoice_id,lead_id',
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

    public function stickerPreview(Request $request)
    {
        abort_unless(app()->environment('local'), 404);

        $absent = $request->query('refs') === 'absent';
        $cold   = $request->boolean('cold');
        $hazCls = $request->filled('haz') ? (string) $request->query('haz')
                : ($request->filled('hazClass') ? (string) $request->query('hazClass') : null);
        $haz    = $hazCls !== null;
        $temp   = $cold ? ($request->query('temp') ?: '2 to 8 °C') : null;

        $flags = [
            'cold'      => $cold,
            'temp'      => $temp,
            'hazardous' => $haz ? 'Yes' : 'No',
            'hazClass'  => $hazCls,
            'fragile'   => $request->boolean('fragile'),
            'stacking'  => ($request->boolean('nostack') || $request->query('stack') === 'no')
                ? 'Do Not Stack' : 'Stackable',
        ];

        $ref = fn ($code, $date) => $absent ? ['code' => null, 'date' => null] : ['code' => $code, 'date' => $date];

        $condition = $request->query('condition', 'minor');
        $scenario  = $request->query('scenario', 's2');

        $data = [
            'box' => (object) ['box_code' => 'B-001'],

            'refs' => [
                'shp'  => $ref('SHP-001',  '29/07/2026'),
                'opp'  => $ref('OPP-0003', '28/07/2026'),
                'proc' => $ref('PC-002',   '25/10/2026'),
                'pi'   => $ref('PI/2026-27/4', '28/07/2026'),
                'po'   => $ref(null, null),
                'spi'  => $ref('SPI/2026-27/007', '29/10/2026'),
            ],
            'parties' => $absent
                ? ['customer' => null, 'consignee' => null, 'supplier' => null]
                : ['customer' => 'C-013', 'consignee' => 'CN-007', 'supplier' => 'S-003'],

            'putawayCode'   => 'PUT-B-001',
            'scenarioLabel' => match ($scenario) {
                's1'    => '1 Product → 1 Box',
                's3'    => 'Multiple Products → 1 Box',
                default => '1 Product → Multiple Boxes',
            },
            'boxQty'      => '11 MT',
            'dims'        => '12 x 12 x 12',
            'netWeight'   => '12 kg',
            'grossWeight' => '15 kg',
            'conditionLabel' => match ($condition) {
                'perfect' => 'Perfect Condition',
                'major'   => 'Major Damage',
                'severe'  => 'Severe Damage',
                default   => 'Minor Damage',
            },

            'flags'       => $flags,
            'coldChain'   => $flags['cold'] ? 'Yes' . ($temp ? " ($temp)" : '') : 'No',
            'hazardLabel' => $flags['hazardous'] . ' (Class: ' . ($hazCls ?: 'N/A') . ')',
            'pictos'      => $this->pictograms($flags),

            'place' => $absent
                ? ['warehouse' => null, 'whName' => null, 'whType' => null, 'zone' => null,
                   'rack' => null, 'shelf' => null, 'path' => null, 'allocatedOn' => null]
                : ['warehouse' => 'W-001', 'whName' => 'Main WH', 'whType' => 'OWN',
                   'zone' => 'ZN-011', 'rack' => 'RN-011', 'shelf' => 'RN-011-SH-011',
                   'path' => 'ZN-011 / RN-011 / RN-011-SH-011', 'allocatedOn' => '03/10/2026'],

            'qr' => $this->qr('https://preview.local/box/B-001'),
        ];

        return Pdf::loadView('pdf.spi-box-sticker', $data)
            ->setPaper('a4', 'portrait')
            ->stream('sticker-preview.pdf');
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

    private function invoiceItemMap($boxes): array
    {
        return $this->resolveLines($boxes)['items'];
    }

    private function uomMap($boxes): array
    {
        return $this->resolveLines($boxes)['uoms'];
    }

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
                'behaviour' => $f->behaviour,
                'is_active' => (int) $f->status === 1,
            ])
            ->all();
    }

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

                'uom'            => $l->uom,

                'product_id'     => $l->product_id === null ? null : (int) $l->product_id,
                'product_code'   => $l->product?->product_code,
                'product_name'   => $l->product?->name ?? $l->product?->generic_name,

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
            'photos.*' => ['file', 'image', 'mimes:jpg,jpeg,png', 'max:8192'],
        ], [
            'photos.*.image' => 'Only JPG or PNG images can be uploaded as box photos.',
            'photos.*.mimes' => 'Only JPG or PNG images can be uploaded as box photos.',
            'photos.*.max'   => 'Each box photo must be 8 MB or smaller.',
        ]);

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

    private function svg(string $body): string
    {
        $doc = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
             . '<rect x="3" y="3" width="94" height="94" rx="12" fill="#fff" stroke="#000" stroke-width="5"/>'
             . $body . '</svg>';

        return 'data:image/svg+xml;base64,' . base64_encode($doc);
    }

    private function icoSnowflake(): string
    {
        $cx = 50; $cy = 50;
        $arm = 32;
        $branchAt = [0.52, 0.80];
        $branchLen = 10;
        $branchAngle = 52;

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

    private function refs(SupplierInvoice $spi, $po): array
    {
        $spi->loadMissing([
            'shipmentOrder.lead:id,opp_code',
            'shipmentOrder.proformaInvoice:id,code,created_at,customer_id,consignee_id',
        ]);
        $po?->loadMissing([
            'shipmentOrder.lead:id,opp_code',
            'shipmentOrder.proformaInvoice:id,code,created_at,customer_id,consignee_id',
            'lead:id,opp_code,created_at',
            'proformaInvoice:id,code,created_at,customer_id,consignee_id',
        ]);

        $shp  = $spi->shipmentOrder ?: $po?->shipmentOrder;
        $pi   = $po?->proformaInvoice ?: $shp?->proformaInvoice;
        $lead = $po?->lead ?: $shp?->lead;

        return [
            'shp'  => ['code' => $shp?->shipment_code,  'date' => $this->day($shp?->created_at)],
            'opp'  => ['code' => $lead?->opp_code,      'date' => $this->day($lead?->created_at)],
            'proc' => [
                'code' => $spi->procurement_request_code ?? $po?->procurement_request_code,
                'date' => $this->day($po?->created_at ?? $spi->created_at),
            ],
            'irm'  => ['code' => null,                  'date' => null],
            'inv'  => ['code' => $spi->invoice_no,      'date' => $this->day($spi->invoice_date)],
            'pi'   => ['code' => $pi?->code,            'date' => $this->day($pi?->created_at)],
            'po'   => ['code' => $po?->code,            'date' => $this->day($po?->po_date)],
            'spi'  => ['code' => $spi->code,            'date' => $this->day($spi->invoice_date)],
        ];
    }

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
                'quietzoneSize'   => 1,
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
