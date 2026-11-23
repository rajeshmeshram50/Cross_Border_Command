<?php

namespace App\Http\Controllers\Api\P2p;

use App\Http\Controllers\Api\P2p\Concerns\RunsInTransaction;
use App\Http\Controllers\Controller;
use App\Models\P2p\PoPhysicalInspection;
use App\Models\P2p\PurchaseOrder;
use App\Models\User;
use App\Services\P2p\PurchaseOrderService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\StreamedResponse;

class PurchaseOrderInspectionController extends Controller
{
    use RunsInTransaction;

    private const FILE_RULE = 'file|max:20480|mimetypes:image/*,video/*,application/pdf';
    private const MAX_PROOF = 10;

    public function __construct(private PurchaseOrderService $svc) {}

    private function ok($data): JsonResponse
    {
        return response()->json(['status' => true, 'data' => $data]);
    }

    private function fail(string $message, int $code = 422): JsonResponse
    {
        return response()->json(['status' => false, 'message' => $message], $code);
    }

    private function inspectable(int $poId): PurchaseOrder|JsonResponse
    {
        $po = PurchaseOrder::findOrFail($poId);
        if ($po->physical_inspection !== 'yes') return $this->fail('This PO does not require physical inspection.');
        if ($po->status !== PurchaseOrder::STATUS_SUBMITTED) return $this->fail('Only a submitted PO can be inspected.');
        return $po;
    }

    private function storeFiles(Request $request, string $field, int $poId): array
    {
        return collect($request->file($field, []))->map(fn ($f) => [
            'path' => $f->store("p2p/po-inspections/{$poId}", 'public'),
            'name' => $f->getClientOriginalName(),
            'mime' => $f->getClientMimeType(),
            'size' => $f->getSize(),
        ])->all();
    }

    private function withUrls(?array $files): array
    {
        return collect($files ?? [])->values()->map(fn ($f, $i) => $f + ['index' => $i, 'url' => file_url($f['path'])])->all();
    }

    public function downloadNoteFile(int $po, int $index): StreamedResponse|JsonResponse
    {
        return $this->streamProof(array_values(PurchaseOrder::findOrFail($po)->inspection_note_files ?? []), $index);
    }

    public function downloadLineFile(int $po, int $item, int $index): StreamedResponse|JsonResponse
    {
        $order = PurchaseOrder::findOrFail($po);
        $row = PoPhysicalInspection::where('purchase_order_item_id', $order->items()->findOrFail($item)->id)->first();
        return $this->streamProof(array_values($row?->proof_files ?? []), $index);
    }

    private function streamProof(array $files, int $index): StreamedResponse|JsonResponse
    {
        if (!isset($files[$index])) return $this->fail('That file is no longer on this inspection.', 404);
        $file = $files[$index];
        $disk = Storage::disk('public');
        if (!$disk->exists($file['path'])) return $this->fail('The file is missing from storage.', 404);

        return $disk->download($file['path'], $file['name'] ?? basename($file['path']));
    }

    private function summary(PurchaseOrder $po): array
    {
        $po->load(['items.inspection', 'vendor:id,vendor_code,company_name,legal_name']);
        $live = $this->svc->lineDetails($po->items);

        $products = DB::table('products')->whereIn('id', $po->items->pluck('product_id')->filter())->pluck('description', 'id');
        $ship = $po->shipment_order_id ? DB::table('shipment_orders')->find($po->shipment_order_id) : null;
        $pi   = $po->proforma_invoice_id ? DB::table('proforma_invoices')->find($po->proforma_invoice_id) : null;
        $names = User::whereIn('id', array_filter([$po->inspected_by, ...$po->items->pluck('inspection.inspected_by')->all()]))->pluck('name', 'id');

        $lines = $po->items->map(fn ($it) => [
            'purchase_order_item_id' => $it->id,
            'line_no'                => $it->line_no,
            'product_id'             => $it->product_id,
            'product_code'           => $live[$it->id]['product_code'],
            'product_name'           => $live[$it->id]['product_name'],
            'hsn_code'               => $live[$it->id]['hsn_code'],
            'uom'                    => $live[$it->id]['uom'],
            'gst_pct'                => (float) $it->gst_pct,
            'description'            => $it->description ?: ($products[$it->product_id] ?? null),
            'quantity'               => (float) $it->quantity,
            'verdict'                => $it->inspection?->verdict,
            'remark'                 => $it->inspection?->remark,
            'proof_files'            => $this->withUrls($it->inspection?->proof_files),
            'inspected_by_name'      => $it->inspection?->inspected_by ? ($names[$it->inspection->inspected_by] ?? null) : null,
            'inspected_at'           => $it->inspection?->inspected_at?->toIso8601String(),
        ])->all();

        return [
            'purchase_order_id'   => $po->id,
            'code'                => $po->code,
            'po_date'             => $po->po_date?->toDateString(),
            'status'              => $po->status,
            'shipment_code'       => $ship->shipment_code ?? null,
            'shipment_date'       => isset($ship->created_at) ? substr((string) $ship->created_at, 0, 10) : null,
            'pi_code'             => $pi->code ?? null,
            'pi_date'             => isset($pi->created_at) ? substr((string) $pi->created_at, 0, 10) : null,
            'opportunity_code'    => $pi->opp_code ?? null,
            'procurement_request_code' => $po->procurement_request_code,
            'supplier_code'       => $po->vendor?->vendor_code,
            'supplier_name'       => $po->vendor ? ($po->vendor->legal_name ?: $po->vendor->company_name) : null,
            'grand_total'         => (float) $po->grand_total,
            'physical_inspection' => $po->physical_inspection,
            'inspection_status'   => $po->inspection_status,
            'lines_total'         => count($lines),
            'lines_marked'        => collect($lines)->whereNotNull('verdict')->count(),
            'inspection_note'     => $po->inspection_note,
            'inspection_note_files' => $this->withUrls($po->inspection_note_files),
            'inspected_by'        => $po->inspected_by,
            'inspected_by_name'   => $po->inspected_by ? ($names[$po->inspected_by] ?? null) : null,
            'inspected_at'        => $po->inspected_at?->toIso8601String(),
            'lines'               => $lines,
        ];
    }

    public function show(int $po): JsonResponse
    {
        return $this->ok($this->summary(PurchaseOrder::findOrFail($po)));
    }

    public function updateLine(Request $request, int $po, int $item): JsonResponse
    {
        $order = $this->inspectable($po);
        if ($order instanceof JsonResponse) return $order;
        if ($order->inspection_status === 'completed') return $this->fail('Inspection is signed off — withdraw the sign-off to change a line.');

        $line = $order->items()->findOrFail($item);
        $request->validate([
            'verdict' => ['nullable', 'required_without:files', Rule::in(PoPhysicalInspection::VERDICTS)],
            'remark'  => 'nullable|string|max:1000',
            'files'   => 'nullable|array|max:' . self::MAX_PROOF,
            'files.*' => self::FILE_RULE,
        ]);

        $adding = count($request->file('files', []));
        if ($adding > 0) {
            $held = count(PoPhysicalInspection::where('purchase_order_item_id', $line->id)->first()?->proof_files ?? []);
            if ($held + $adding > self::MAX_PROOF) {
                $room = max(0, self::MAX_PROOF - $held);
                return $this->fail($room === 0
                    ? 'This product already has ' . self::MAX_PROOF . ' proof files — remove one to add another.'
                    : "Only {$room} more proof file(s) can be added to this product (up to " . self::MAX_PROOF . ' in total).');
            }
        }

        $stored = $this->storeFiles($request, 'files', $order->id);
        $this->inTransaction('save the inspection line', function () use ($line, $order, $request, $stored) {
            $row = PoPhysicalInspection::firstOrNew(['purchase_order_item_id' => $line->id], ['purchase_order_id' => $order->id]);
            $row->fill([
                'verdict'      => $request->input('verdict', $row->verdict),
                'remark'       => $request->has('remark') ? $request->input('remark') : $row->remark,
                'proof_files'  => array_merge($row->proof_files ?? [], $stored),
                'inspected_by' => $request->user()->id,
                'inspected_at' => now(),
            ])->save();
        }, array_column($stored, 'path'));

        return $this->ok($this->summary($order));
    }

    public function removeFile(int $po, int $item, int $index): JsonResponse
    {
        $order = $this->inspectable($po);
        if ($order instanceof JsonResponse) return $order;
        if ($order->inspection_status === 'completed') return $this->fail('Inspection is signed off — withdraw the sign-off to change a line.');

        $row = PoPhysicalInspection::where('purchase_order_item_id', $order->items()->findOrFail($item)->id)->firstOrFail();
        $files = array_values($row->proof_files ?? []);
        if (!isset($files[$index])) return $this->fail('That file is no longer on this line.', 404);
        $gone = $files[$index]['path'];
        array_splice($files, $index, 1);
        $this->inTransaction('remove the proof file', fn () => $row->update(['proof_files' => $files]));
        Storage::disk('public')->delete($gone);

        return $this->ok($this->summary($order));
    }

    public function signOff(Request $request, int $po): JsonResponse
    {
        $order = $this->inspectable($po);
        if ($order instanceof JsonResponse) return $order;
        $request->validate([
            'note'    => 'nullable|string|max:1000',
            'files'   => 'nullable|array|max:' . self::MAX_PROOF,
            'files.*' => self::FILE_RULE,
        ]);

        $unmarked = $order->items()->whereDoesntHave('inspection', fn ($q) => $q->whereNotNull('verdict'))->count();
        if ($unmarked > 0) return $this->fail("{$unmarked} line(s) have no verdict yet — mark every line before signing off.");

        $stored = $this->storeFiles($request, 'files', $order->id);
        $this->inTransaction('sign off the inspection', fn () => $order->update([
            'inspection_status'     => 'completed',
            'inspection_note'       => $request->input('note'),
            'inspection_note_files' => $stored,
            'inspected_by'          => $request->user()->id,
            'inspected_at'          => now(),
            'updated_by'            => $request->user()->id,
        ]), array_column($stored, 'path'));
        return $this->ok($this->summary($order->fresh()));
    }

    public function withdraw(Request $request, int $po): JsonResponse
    {
        $order = $this->inspectable($po);
        if ($order instanceof JsonResponse) return $order;
        if ($order->inspection_status !== 'completed') return $this->fail('There is no sign-off to withdraw.');

        $this->inTransaction('withdraw the sign-off', fn () => $order->update(['inspection_status' => 'pending', 'inspected_by' => null, 'inspected_at' => null, 'updated_by' => $request->user()->id]));
        return $this->ok($this->summary($order->fresh()));
    }
}
