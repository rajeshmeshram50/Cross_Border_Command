<?php

namespace App\Http\Controllers\Api\P2p;

use App\Http\Controllers\Controller;
use App\Models\P2p\PoPhysicalInspection;
use App\Models\P2p\PurchaseOrder;
use App\Services\P2p\PurchaseOrderService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;

/**
 * P2P · Physical inspection of a submitted PO — a verdict and proof per line,
 * then a sign-off on the PO header. /api/p2p/orders/{po}/inspection
 */
class PurchaseOrderInspectionController extends Controller
{
    public function __construct(private PurchaseOrderService $svc) {}

    private function ok($data): JsonResponse
    {
        return response()->json(['status' => true, 'data' => $data]);
    }

    private function fail(string $message, int $code = 422): JsonResponse
    {
        return response()->json(['status' => false, 'message' => $message], $code);
    }

    /** Only a submitted, not-cancelled PO that requires inspection can be inspected. */
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

    private function summary(PurchaseOrder $po): array
    {
        $po->load(['items.inspection']);
        $live = $this->svc->lineDetails($po->items);
        $lines = $po->items->map(fn ($it) => [
            'purchase_order_item_id' => $it->id,
            'line_no'                => $it->line_no,
            'product_code'           => $live[$it->id]['product_code'],
            'product_name'           => $live[$it->id]['product_name'],
            'quantity'               => (float) $it->quantity,
            'verdict'                => $it->inspection?->verdict,
            'remark'                 => $it->inspection?->remark,
            'proof_files'            => collect($it->inspection?->proof_files ?? [])
                ->map(fn ($f) => $f + ['url' => Storage::disk('public')->url($f['path'])])->all(),
            'inspected_at'           => $it->inspection?->inspected_at?->toIso8601String(),
        ])->all();

        return [
            'purchase_order_id'   => $po->id,
            'code'                => $po->code,
            'physical_inspection' => $po->physical_inspection,
            'inspection_status'   => $po->inspection_status,
            'lines_total'         => count($lines),
            'lines_marked'        => collect($lines)->whereNotNull('verdict')->count(),
            'inspection_note'     => $po->inspection_note,
            'inspected_by'        => $po->inspected_by,
            'inspected_at'        => $po->inspected_at?->toIso8601String(),
            'lines'               => $lines,
        ];
    }

    /** GET /p2p/orders/{po}/inspection */
    public function show(int $po): JsonResponse
    {
        return $this->ok($this->summary(PurchaseOrder::findOrFail($po)));
    }

    /** POST /p2p/orders/{po}/inspection/lines/{item} (multipart) — verdict, remark, proof files. */
    public function updateLine(Request $request, int $po, int $item): JsonResponse
    {
        $order = $this->inspectable($po);
        if ($order instanceof JsonResponse) return $order;
        if ($order->inspection_status === 'completed') return $this->fail('Inspection is signed off — withdraw the sign-off to change a line.');

        $line = $order->items()->findOrFail($item);
        $request->validate([
            'verdict'  => ['required', Rule::in(PoPhysicalInspection::VERDICTS)],
            'remark'   => 'nullable|string|max:1000',
            'files'    => 'nullable|array|max:10',
            'files.*'  => 'file|max:10240|mimes:jpg,jpeg,png,webp,pdf,mp4,mov',
        ]);

        $row = PoPhysicalInspection::firstOrNew(['purchase_order_item_id' => $line->id], ['purchase_order_id' => $order->id]);
        $row->fill([
            'verdict'      => $request->input('verdict'),
            'remark'       => $request->input('remark'),
            // New proof is added to what is already there, never replacing it.
            'proof_files'  => array_merge($row->proof_files ?? [], $this->storeFiles($request, 'files', $order->id)),
            'inspected_by' => $request->user()->id,
            'inspected_at' => now(),
        ])->save();

        return $this->ok($this->summary($order));
    }

    /** POST /p2p/orders/{po}/inspection/sign-off — every line must carry a verdict. */
    public function signOff(Request $request, int $po): JsonResponse
    {
        $order = $this->inspectable($po);
        if ($order instanceof JsonResponse) return $order;
        $request->validate([
            'note'    => 'nullable|string|max:1000',
            'files'   => 'nullable|array|max:10',
            'files.*' => 'file|max:10240|mimes:jpg,jpeg,png,webp,pdf,mp4,mov',
        ]);

        $unmarked = $order->items()->whereDoesntHave('inspection', fn ($q) => $q->whereNotNull('verdict'))->count();
        if ($unmarked > 0) return $this->fail("{$unmarked} line(s) have no verdict yet — mark every line before signing off.");

        $order->update([
            'inspection_status'     => 'completed',
            'inspection_note'       => $request->input('note'),
            'inspection_note_files' => $this->storeFiles($request, 'files', $order->id),
            'inspected_by'          => $request->user()->id,
            'inspected_at'          => now(),
            'updated_by'            => $request->user()->id,
        ]);
        return $this->ok($this->summary($order->fresh()));
    }

    /** POST /p2p/orders/{po}/inspection/withdraw — reopen a signed-off inspection. */
    public function withdraw(Request $request, int $po): JsonResponse
    {
        $order = $this->inspectable($po);
        if ($order instanceof JsonResponse) return $order;
        if ($order->inspection_status !== 'completed') return $this->fail('There is no sign-off to withdraw.');

        $order->update(['inspection_status' => 'pending', 'inspected_by' => null, 'inspected_at' => null, 'updated_by' => $request->user()->id]);
        return $this->ok($this->summary($order->fresh()));
    }
}
