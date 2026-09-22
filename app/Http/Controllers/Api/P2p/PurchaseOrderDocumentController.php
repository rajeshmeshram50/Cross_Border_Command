<?php

namespace App\Http\Controllers\Api\P2p;

use App\Http\Controllers\Api\P2p\Concerns\RunsInTransaction;
use App\Http\Controllers\Controller;
use App\Models\P2p\PurchaseOrder;
use App\Models\P2p\PurchaseOrderDocument;
use App\Models\ClmSignatureRequest;
use App\Services\P2p\PoDocumentService;
use App\Services\P2p\PurchaseOrderService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;

/**
 * P2P · Create Purchase Order — Stage 04 documents.
 * /api/p2p/orders/{po}/documents
 */
class PurchaseOrderDocumentController extends Controller
{
    use RunsInTransaction;

    public function __construct(private PurchaseOrderService $svc, private PoDocumentService $docs) {}

    private function ok($data, int $code = 200): JsonResponse
    {
        return response()->json(['status' => true, 'data' => $data], $code);
    }

    private function fail(string $message, int $code = 422): JsonResponse
    {
        return response()->json(['status' => false, 'message' => $message], $code);
    }

    /** The PO (tenant-scoped) and one of its documents. */
    private function find(int $poId, ?int $docId = null): array
    {
        $po = PurchaseOrder::findOrFail($poId);
        $doc = $docId ? $po->documents()->findOrFail($docId) : null;
        return [$po, $doc];
    }

    private function shape(PurchaseOrderDocument $d, ?ClmSignatureRequest $sig = null): array
    {
        $ids = $sig && is_array($sig->trade_doc_ids) ? array_map('intval', $sig->trade_doc_ids) : [];
        // A request raised through the CLM flow lists LIBRARY ids; one raised
        // for our own files (the Purchase Order PDF) lists our row ids.
        $mine = $sig?->document_type === ClmSignatureRequest::DOC_P2P_PO_DOCUMENT || $d->source_id === null
            ? (int) $d->id
            : (int) $d->source_id;
        $pos = array_search($mine, $ids, true);
        return $d->toArray() + [
            'file_url'         => $d->file_path ? file_url($d->file_path) : null,
            // For the signing tracker: /clm/signature-requests/{id}, signed file at {index}
            'signature_status' => $sig?->status,
            'signature_index'  => $pos === false ? null : $pos,
        ];
    }

    /** Documents of the PO with their signature requests, statuses synced first. */
    private function listShaped(PurchaseOrder $order): array
    {
        // Trade documents / agreements are signed through the CLM flow, which
        // raises its request against the library id — claim those first, then
        // bring every linked request's status up to date.
        $this->docs->adoptClmSignatures($order);
        $this->docs->syncSignatures($order->documents()->get());
        $docs = $order->documents()->orderBy('id')->get();
        $sigs = ClmSignatureRequest::whereIn('id', $docs->pluck('signature_request_id')->filter()->unique())->get()->keyBy('id');
        return $docs->map(fn ($d) => $this->shape($d, $d->signature_request_id ? $sigs->get($d->signature_request_id) : null))->all();
    }

    /** The selected documents of a PO; each must have a file. */
    private function selected(PurchaseOrder $order, array $ids)
    {
        $docs = $order->documents()->whereIn('id', $ids)->orderBy('id')->get();
        if ($docs->count() !== count(array_unique($ids))) abort(response()->json(['status' => false, 'message' => 'Some documents were not found on this PO.'], 422));
        $noFile = $docs->filter(fn ($d) => !$d->file_path)->pluck('name');
        if ($noFile->isNotEmpty()) abort(response()->json(['status' => false, 'message' => 'Attach a file first: ' . $noFile->implode(', ') . '.'], 422));
        return $docs;
    }

    /** GET /p2p/orders/{po}/documents */
    public function index(int $po): JsonResponse
    {
        [$order] = $this->find($po);
        return $this->ok($this->listShaped($order));
    }

    /**
     * POST /p2p/orders/{po}/documents/needs — mark documents Necessary or not
     * on THIS purchase order. The Purchase Order itself is the one row that
     * cannot be waved away; every library document is decided here.
     *
     * Body: { items: [{ id, needed }] } — one call for the whole selection.
     */
    public function setNeeds(Request $request, int $po): JsonResponse
    {
        $user = $request->user();
        [$order] = $this->find($po);
        if ($order->isCancelled()) return $this->fail('This PO is cancelled.');

        $data = $request->validate([
            'items'          => 'required|array|min:1',
            'items.*.id'     => 'required|integer',
            'items.*.needed' => 'required|boolean',
        ]);

        $wanted = collect($data['items'])->keyBy('id');
        $docs = $order->documents()->whereIn('id', $wanted->keys())->get();
        if ($docs->count() !== $wanted->count()) return $this->fail('Some documents were not found on this PO.');

        // The Purchase Order itself, and nothing else — its kind is what says
        // so, which also covers rows seeded before the marking existed.
        $mandatory = $docs->filter(fn ($d) => $d->doc_kind === 'purchase_order' && !$wanted[$d->id]['needed']);
        if ($mandatory->isNotEmpty()) {
            return $this->fail($mandatory->pluck('name')->implode(', ') . ' always goes with the order and cannot be marked not necessary.');
        }
        // Out for signature or signed: the answer is settled. A declined /
        // recalled request puts the row back to pending, which frees it again.
        $settled = $docs->filter(fn ($d) => in_array($d->status, [PurchaseOrderDocument::STATUS_SENT, PurchaseOrderDocument::STATUS_SIGNED], true));
        if ($settled->isNotEmpty()) {
            return $this->fail($settled->pluck('name')->implode(', ') . ' has already been sent for signature — it stays Necessary.');
        }

        $this->inTransaction('save the document decisions', function () use ($docs, $wanted, $user) {
            foreach ($docs as $doc) {
                $doc->update([
                    'needed'     => $wanted[$doc->id]['needed'] ? 'yes' : 'no',
                    'needed_by'  => $user?->id,
                    'needed_at'  => now(),
                    'updated_by' => $user?->id,
                ]);
            }
        });

        return $this->ok($this->listShaped($order->fresh()));
    }

    /** POST /p2p/orders/{po}/documents (multipart) — add a document, or its file. */
    public function store(Request $request, int $po): JsonResponse
    {
        $user = $request->user();
        [$order] = $this->find($po);
        if ($order->isCancelled()) return $this->fail('This PO is cancelled.');

        $data = $request->validate([
            'name'        => 'required|string|max:150',
            'doc_kind'    => ['nullable', Rule::in(PurchaseOrderDocument::KINDS)],
            'is_required' => ['nullable', Rule::in(['yes', 'no'])],
            'valid_up_to' => 'nullable|date',
            'file'        => 'nullable|file|max:10240|mimes:pdf,doc,docx,jpg,jpeg,png',
        ]);

        // The file is stored first; if the row can't be written it is removed again.
        $file = $request->file('file');
        $path = $file?->store("p2p/po-documents/{$order->id}", 'public');
        $doc = $this->inTransaction('add the document', function () use ($order, $user, $data, $file, $path) {
            return PurchaseOrderDocument::create([
                'client_id'         => $order->client_id,
                'branch_id'         => $order->branch_id,
                'purchase_order_id' => $order->id,
                'code'              => $this->svc->nextDocCode((int) $order->client_id),
                'name'              => $data['name'],
                'doc_kind'          => $data['doc_kind'] ?? 'other',
                'is_required'       => $data['is_required'] ?? 'no',
                'generated_on'      => now()->toDateString(),
                'valid_up_to'       => $data['valid_up_to'] ?? null,
                'file_path'         => $path,
                'original_name'     => $file?->getClientOriginalName(),
                'mime_type'         => $file?->getClientMimeType(),
                'size_bytes'        => $file?->getSize(),
                'status'            => PurchaseOrderDocument::STATUS_PENDING,
                'created_by'        => $user->id,
                'updated_by'        => $user->id,
            ]);
        }, [$path]);

        return $this->ok($this->shape($doc), 201);
    }

    /** POST /p2p/orders/{po}/documents/{doc}/file (multipart) — attach or replace the file. */
    public function uploadFile(Request $request, int $po, int $doc): JsonResponse
    {
        [$order, $document] = $this->find($po, $doc);
        if ($document->status === PurchaseOrderDocument::STATUS_SIGNED) return $this->fail('A signed document cannot be replaced.');
        $request->validate(['file' => 'required|file|max:10240|mimes:pdf,doc,docx,jpg,jpeg,png']);

        $file = $request->file('file');
        $old = $document->file_path;
        $path = $file->store("p2p/po-documents/{$order->id}", 'public');
        $this->inTransaction('attach the file', fn () => $document->update([
            'file_path'     => $path,
            'original_name' => $file->getClientOriginalName(),
            'mime_type'     => $file->getClientMimeType(),
            'size_bytes'    => $file->getSize(),
            'generated_on'  => now()->toDateString(),
            'updated_by'    => $request->user()->id,
        ]), [$path]);
        // The old file goes only once the new one is safely recorded.
        if ($old) Storage::disk('public')->delete($old);
        return $this->ok($this->shape($document->fresh()));
    }

    /** PATCH /p2p/orders/{po}/documents/{doc}/status — pending → sent → signed. */
    public function updateStatus(Request $request, int $po, int $doc): JsonResponse
    {
        [, $document] = $this->find($po, $doc);
        $data = $request->validate(['status' => ['required', Rule::in([PurchaseOrderDocument::STATUS_SENT, PurchaseOrderDocument::STATUS_SIGNED])]]);
        if ($document->status === PurchaseOrderDocument::STATUS_SIGNED) return $this->fail('This document is already signed.');
        if (!$document->file_path) return $this->fail('Attach the document file before sending it.');

        $attrs = ['status' => $data['status'], 'updated_by' => $request->user()->id];
        if ($data['status'] === PurchaseOrderDocument::STATUS_SENT) $attrs['sent_at'] = now();
        if ($data['status'] === PurchaseOrderDocument::STATUS_SIGNED) $attrs += ['signed_at' => now(), 'sent_at' => $document->sent_at ?? now()];
        $this->inTransaction('update the document status', fn () => $document->update($attrs));
        return $this->ok($this->shape($document->fresh()));
    }

    /** POST /p2p/orders/{po}/documents/{doc}/generate — re-render the Purchase Order PDF. */
    public function generate(Request $request, int $po, int $doc): JsonResponse
    {
        [$order, $document] = $this->find($po, $doc);
        if ($document->doc_kind !== 'purchase_order') return $this->fail('Only the Purchase Order document is generated.');
        if ($document->status !== PurchaseOrderDocument::STATUS_PENDING) return $this->fail('A sent or signed document cannot be regenerated.');
        try {
            $this->docs->generatePoDocument($order, $document, $request->user()->id);
        } catch (\Throwable $e) {
            return $this->fail('Could not generate the PDF: ' . $e->getMessage(), 500);
        }
        return $this->ok($this->shape($document->fresh()));
    }

    /** POST /p2p/orders/{po}/documents/sign — send the selected documents to the supplier via Zoho Sign. */
    public function sign(Request $request, int $po): JsonResponse
    {
        [$order] = $this->find($po);
        if ($order->status !== PurchaseOrder::STATUS_SUBMITTED) return $this->fail('Submit the PO before sending documents for signature.');
        $data = $request->validate([
            'document_ids'   => 'required|array|min:1',
            'document_ids.*' => 'integer',
            'signer_name'    => 'nullable|string|max:255',
            'signer_email'   => 'nullable|email|max:255',
            'notes'          => 'nullable|string|max:1000',
            'expiry_days'    => 'nullable|integer|min:1|max:90',
            // Several people can sign the same request; each keeps a role so
            // the box dragged for them is the box they get.
            'signers'            => 'nullable|array|max:6',
            'signers.*.name'     => 'nullable|string|max:255',
            'signers.*.email'    => 'required_with:signers|email|max:255',
            'signers.*.role'     => 'nullable|string|max:40',
            // { documentId: {x,y,page,width,height} | {role: {...}} | {boxes:[…]} }
            'document_settings'  => 'nullable|array',
        ]);
        $docs = $this->selected($order, $data['document_ids']);
        $busy = $docs->filter(fn ($d) => $d->status !== PurchaseOrderDocument::STATUS_PENDING)->pluck('name');
        if ($busy->isNotEmpty()) return $this->fail('Already sent or signed: ' . $busy->implode(', ') . '.');

        // The supplier's own contact is the default signer; a screen that
        // collected its own signer list carries them instead.
        $contact = $this->docs->supplierContact($order);
        $signer = ['name' => $data['signer_name'] ?? $contact['name'], 'email' => strtolower((string) ($data['signer_email'] ?? $contact['email']))];
        if (empty($data['signers']) && (!$signer['email'] || !filter_var($signer['email'], FILTER_VALIDATE_EMAIL))) {
            return $this->fail('No valid email for this supplier. Set a primary contact email on the supplier first.');
        }
        try {
            $sig = $this->docs->sendForSignature($order, $docs, $signer, $data, $request->user()->id, $request->user()->branch_id);
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::error('PO documents e-sign failed', ['po' => $order->id, 'err' => $e->getMessage()]);
            return $this->fail('Could not send for signature: ' . $e->getMessage(), 502);
        }
        return $this->ok(['signature_request_id' => $sig->id, 'signer' => $signer, 'documents' => $this->listShaped($order)]);
    }

    /** POST /p2p/orders/{po}/documents/email — email the selected documents to the supplier. */
    public function email(Request $request, int $po): JsonResponse
    {
        [$order] = $this->find($po);
        $data = $request->validate([
            'document_ids'   => 'required|array|min:1',
            'document_ids.*' => 'integer',
            'to'             => 'nullable|email|max:255',
        ]);
        $docs = $this->selected($order, $data['document_ids']);
        try {
            $to = $this->docs->email($order, $docs, $data['to'] ?? null);
        } catch (\RuntimeException $e) {
            return $this->fail($e->getMessage());
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::error('PO documents email failed', ['po' => $order->id, 'err' => $e->getMessage()]);
            return $this->fail('Could not send the email. Please try again.', 500);
        }
        return $this->ok(['to' => $to, 'count' => $docs->count()]);
    }

    /** GET /p2p/orders/{po}/documents/{doc}/download */
    public function download(int $po, int $doc)
    {
        [, $document] = $this->find($po, $doc);
        if (!$document->file_path || !Storage::disk('public')->exists($document->file_path)) abort(404);
        return Storage::disk('public')->download($document->file_path, $document->original_name ?: basename($document->file_path));
    }

    /** DELETE /p2p/orders/{po}/documents/{doc} — not once signed, and never a required one. */
    public function destroy(Request $request, int $po, int $doc): JsonResponse
    {
        [, $document] = $this->find($po, $doc);
        if ($document->status === PurchaseOrderDocument::STATUS_SIGNED) return $this->fail('A signed document cannot be deleted.');
        if ($document->is_required === 'yes') return $this->fail('A required document cannot be deleted.');
        $this->inTransaction('delete the document', function () use ($document, $request) {
            $document->update(['updated_by' => $request->user()->id]);
            $document->delete();
        });
        return $this->ok(['id' => $doc, 'deleted' => true]);
    }
}
