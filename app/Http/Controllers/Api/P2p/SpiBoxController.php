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
                ->where('client_id', $clientId)
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
            "{$p}items.*.flags"                    => ['nullable', 'array', 'max:20'],
            "{$p}items.*.flags.*"                  => ['integer', 'distinct', $flagExists],
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
            ->when($clientId, fn ($q) => $q->where('client_id', $clientId))
            /* The master is branch-scoped, so a box is checked against its own
               branch's flag — plus any the client defined for every branch
               (branch_id NULL), which the masters treat as shared. */
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
