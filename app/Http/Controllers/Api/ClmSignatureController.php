<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Client;
use App\Models\ClmSignatureRequest;
use App\Models\ClmTradeDocLibrary;
use App\Models\Consignee;
use App\Models\Customer;
use App\Models\Vendor;
use App\Services\ZohoSignService;
use Illuminate\Database\Eloquent\Model;
use Barryvdh\DomPDF\Facade\Pdf;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use RuntimeException;

/**
 * CLM Trade Document → Send for Signature (Zoho Sign).
 *
 * Backs the "Send for Signature" modal on Sales → Customers. Picks up one
 * or more [[ClmTradeDocLibrary]] drafts, renders each as a PDF with the
 * customer's data merged into the {{customer.*}} placeholders, ships them
 * to Zoho Sign in a single request, then tracks the status + signed PDFs
 * + completion certificate in clm_signature_requests.
 *
 * Mirrors the New_IDIMS_6.0 DocumentController flow but split across:
 *   - [[ZohoSignService]] (token cache + low-level HTTP)
 *   - this controller (validation, PDF generation, persistence)
 */
class ClmSignatureController extends Controller
{
    public function __construct(private ZohoSignService $zoho)
    {
        $this->ensureTempDir();
        $this->ensureStorageDirs();
    }

    private function ensureTempDir(): void
    {
        $tmp = storage_path('app/temp');
        if (!is_dir($tmp)) @mkdir($tmp, 0775, true);
    }

    private function ensureStorageDirs(): void
    {
        foreach (['uploads/signed_documents/customer', 'uploads/signed_documents/consignee', 'uploads/signed_documents/vendor'] as $p) {
            if (!Storage::disk('public')->exists($p)) Storage::disk('public')->makeDirectory($p);
        }
    }

    /* ─────────────────────── PREVIEW ─────────────────────── */

    /**
     * Render a single draft as a PDF with the customer's data merged in.
     * Used by the frontend modal step 3 to show what's about to be sent
     * and to let the user position the Signature field. **Does NOT call
     * Zoho** — the goal is a fast local render so the preview is snappy.
     *
     * Body: { trade_doc_id, party_id, model_name? }
     */
    public function preview(Request $request)
    {
        $user = $request->user(); if (!$user) abort(401);

        $data = $request->validate([
            'trade_doc_id' => 'required|integer|exists:clm_trade_doc_library,id',
            'party_id'     => 'required|integer',
            'model_name'   => 'nullable|string|in:Customer,Consignee,Vendor',
            // Per-render overrides for the page-shell zones. When the
            // Send-for-Signature modal lets the user tweak the header /
            // footer / body inline (Insert Table, edit header colours,
            // etc.), the SPA POSTs the in-progress config here so the
            // preview reflects the edit before they hit Send. Saved
            // trade-doc row is NOT mutated by this path — overrides
            // only apply to this PDF render.
            'header_config_override' => 'nullable|array',
            'footer_config_override' => 'nullable|array',
            'content_override'       => 'nullable|string',
        ]);
        $modelName = $data['model_name'] ?? 'Customer';

        $doc   = ClmTradeDocLibrary::where('client_id', $user->client_id)->findOrFail($data['trade_doc_id']);
        $party = $this->loadParty($modelName, (int) $data['party_id'], $user);

        $pdf = $this->renderPdf(
            $doc, $party, $modelName, Str::uuid()->toString(),
            null,
            $data['header_config_override'] ?? null,
            $data['footer_config_override'] ?? null,
            $data['content_override'] ?? null,
        );

        return response($pdf->output(), 200, [
            'Content-Type'        => 'application/pdf',
            'Content-Disposition' => 'inline; filename="preview-' . ($doc->code ?: $doc->id) . '.pdf"',
            'Cache-Control'       => 'no-store',
        ]);
    }

    /**
     * Resolve a party row for the given `model_name`. The three party
     * models share a `forUser($user)` scope (via App\Support\MasterVisibility)
     * so they all honour the same sub-branch visibility rules — abort with
     * 404 if the caller's tier can't see the requested id.
     */
    private function loadParty(string $modelName, int $partyId, $user): Model
    {
        switch ($modelName) {
            case 'Customer':  return Customer::query()->forUser($user)->findOrFail($partyId);
            case 'Consignee': return Consignee::query()->forUser($user)->findOrFail($partyId);
            case 'Vendor':    return Vendor::query()->forUser($user)->findOrFail($partyId);
        }
        abort(422, "Unsupported model_name: {$modelName}");
    }

    /* ─────────────────────── SEND ─────────────────────── */

    public function send(Request $request)
    {
        $user = $request->user(); if (!$user) abort(401);
        if (!$user->client_id) return response()->json(['status' => false, 'message' => 'No tenant context'], 403);

        if (!$this->zoho->isConfigured()) {
            return response()->json(['status' => false, 'message' => 'Zoho Sign is not configured. Contact your administrator.'], 503);
        }

        $data = $request->validate([
            'trade_doc_ids'        => 'required|array|min:1|max:10',
            'trade_doc_ids.*'      => 'integer|exists:clm_trade_doc_library,id',
            'party_id'             => 'required|integer',
            'model_name'           => 'nullable|string|in:Customer,Consignee,Vendor',
            'signers'              => 'required|array|min:1|max:5',
            'signers.*.email'      => 'required|email',
            'signers.*.name'       => 'required|string|max:255',
            'signers.*.order'      => 'nullable|integer|min:1',
            'expiry_days'          => 'nullable|integer|min:1|max:180',
            'is_sequential'        => 'nullable|boolean',
            'notes'                => 'nullable|string|max:1000',
            'document_settings'    => 'nullable|array', // keyed by trade_doc_id → {x,y,page,width,height}
            // Per-doc overrides — same keying convention as
            // document_settings. Each map is { trade_doc_id: payload }
            // so a multi-doc send can carry independent header/footer/
            // body tweaks per draft. Saved trade-doc rows are NOT
            // mutated by this path; overrides only apply to the PDFs
            // shipped to Zoho for this send.
            'header_config_overrides'   => 'nullable|array',
            'footer_config_overrides'   => 'nullable|array',
            'content_overrides'         => 'nullable|array',
        ]);

        $modelName = $data['model_name'] ?? 'Customer';
        $party     = $this->loadParty($modelName, (int) $data['party_id'], $user);

        $docs = ClmTradeDocLibrary::where('client_id', $user->client_id)
            ->whereIn('id', $data['trade_doc_ids'])
            ->get()
            ->keyBy('id');

        if ($docs->isEmpty()) {
            return response()->json(['status' => false, 'message' => 'No accessible documents in the selection.'], 422);
        }

        // Preserve the user's chosen order, not whatever DB order we got back.
        $orderedDocs = collect($data['trade_doc_ids'])
            ->map(fn ($id) => $docs->get($id))
            ->filter()
            ->values();

        $tempPaths    = [];
        $localDocMeta = [];   // parallel meta we'll use after Zoho returns
        $requestUuid  = (string) Str::uuid();

        try {
            // 1. Render each draft to a temp PDF on disk.
            $headerByDoc  = (array) ($data['header_config_overrides'] ?? []);
            $footerByDoc  = (array) ($data['footer_config_overrides'] ?? []);
            $contentByDoc = (array) ($data['content_overrides']       ?? []);
            foreach ($orderedDocs as $doc) {
                $docKey         = (string) $doc->id;
                $headerOverride = is_array($headerByDoc[$docKey]  ?? null) ? $headerByDoc[$docKey]  : null;
                $footerOverride = is_array($footerByDoc[$docKey]  ?? null) ? $footerByDoc[$docKey]  : null;
                $contentOver    = is_string($contentByDoc[$docKey] ?? null) ? $contentByDoc[$docKey] : null;
                $pdf  = $this->renderPdf(
                    $doc, $party, $modelName, $requestUuid, $data['signers'],
                    $headerOverride, $footerOverride, $contentOver,
                );
                $tmp  = storage_path('app/temp/' . Str::uuid()->toString() . '.pdf');
                file_put_contents($tmp, $pdf->output());
                $tempPaths[]     = $tmp;
                $localDocMeta[]  = [
                    'id'            => $doc->id,
                    'document_name' => $doc->code ? "{$doc->code} {$doc->name}" : $doc->name,
                ];
            }

            // 2. Build the Zoho request body — recipient actions + metadata.
            $expiryDays = (int) ($data['expiry_days'] ?? 30);
            $actions = [];
            foreach ($data['signers'] as $i => $signer) {
                $actions[] = [
                    'recipient_email'  => $signer['email'],
                    'recipient_name'   => $signer['name'],
                    'action_type'      => 'SIGN',
                    'signing_order'    => $signer['order'] ?? ($i + 1),
                    'verify_recipient' => false,
                ];
            }

            $requestName = $orderedDocs->count() > 1
                ? 'Multiple Documents: ' . $orderedDocs->pluck('name')->take(3)->implode(', ')
                  . ($orderedDocs->count() > 3 ? '…' : '')
                : (string) $orderedDocs->first()->name;

            $requestBody = [
                'requests' => [
                    'request_name'     => $requestName,
                    'is_sequential'    => (bool) ($data['is_sequential'] ?? false),
                    'expiration_days'  => $expiryDays,
                    'notes'            => (string) ($data['notes'] ?? 'Please review and sign these documents.'),
                    'actions'          => $actions,
                ],
            ];

            $filenames = array_map(fn ($m) => Str::slug($m['document_name']) ?: ('document_' . $m['id']), $localDocMeta);

            // 3. Create the Zoho request (multipart — JSON + N PDFs).
            $createResp     = $this->zoho->createRequestMultipart($tempPaths, $filenames, $requestBody);
            $zohoRequestId  = data_get($createResp, 'requests.request_id');
            if (!$zohoRequestId) {
                throw new RuntimeException('Zoho create-request did not return a request_id: ' . json_encode($createResp));
            }

            // 4. Fetch the created request so we know its action_ids + document_ids.
            $details          = $this->zoho->getRequest($zohoRequestId);
            $zohoActions      = data_get($details, 'requests.actions',       []);
            $zohoDocumentIds  = data_get($details, 'requests.document_ids',  []);

            // 5. Build the per-document signature field coords and submit.
            $perDocCoords = $this->mapClientCoordsToZohoDocIds(
                (array) ($data['document_settings'] ?? []),
                $orderedDocs->pluck('id')->all(),
                $zohoDocumentIds
            );

            $submitResp = $this->zoho->submitWithFields($zohoRequestId, $zohoActions, $zohoDocumentIds, $perDocCoords);
            $submitted  = isset($submitResp['requests']);

            // 6. Read back the final status. Zoho takes a tick to flip from
            // 'draft' to 'inprogress' so we briefly sleep before re-fetching.
            $finalStatus = 'draft';
            if ($submitted) {
                try {
                    sleep(1);
                    $after = $this->zoho->getRequest($zohoRequestId);
                    $finalStatus = strtolower((string) data_get($after, 'requests.request_status', 'inprogress'));
                } catch (\Throwable $e) {
                    Log::warning('Zoho post-submit status fetch failed: ' . $e->getMessage());
                    $finalStatus = 'inprogress';
                }
            }

            // 7. Persist.
            $sigReq = new ClmSignatureRequest();
            $sigReq->client_id           = $user->client_id;
            $sigReq->branch_id           = $user->branch_id ?? null;
            $sigReq->trade_doc_id        = $orderedDocs->first()->id;
            $sigReq->trade_doc_ids       = $orderedDocs->pluck('id')->values()->all();
            $sigReq->document_names      = collect($localDocMeta)->pluck('document_name')->values()->all();
            $sigReq->zoho_document_ids   = array_values(array_filter(array_map(fn ($d) => $d['document_id'] ?? null, $zohoDocumentIds)));
            $sigReq->model_name          = $modelName;
            $sigReq->party_id            = $party->id;
            $sigReq->zoho_request_id     = $zohoRequestId;
            $sigReq->request_name        = $requestName;
            $sigReq->status              = $finalStatus;
            $sigReq->signers             = $data['signers'];
            $sigReq->expiry_date         = now()->addDays($expiryDays);
            $sigReq->metadata            = [
                'sent_at'           => now()->toIso8601String(),
                'is_multi_document' => $orderedDocs->count() > 1,
                'document_ids'      => $orderedDocs->pluck('id')->values()->all(),
                'document_names'    => collect($localDocMeta)->pluck('document_name')->values()->all(),
                'document_count'    => $orderedDocs->count(),
                'party'             => [
                    'id'             => $party->id,
                    'company_name'   => $party->company_name,
                    'primary_email'  => $party->primary_email,
                ],
                'document_settings' => $data['document_settings'] ?? null,
                'request_uuid'      => $requestUuid,
            ];
            $sigReq->created_by          = Auth::id();
            $sigReq->save();

            $message = $finalStatus === 'inprogress'
                ? 'Documents sent for signature successfully.'
                : 'Documents created in Zoho but submission did not flip to inprogress.';
            if ($this->zoho->isTestingMode()) {
                $message .= ' (Sandbox mode — signer emails are only delivered if the recipient is a Zoho Sign user on this org.)';
            }

            return response()->json([
                'status'  => true,
                'message' => $message,
                'data'    => [
                    'signature_request_id' => $sigReq->id,
                    'zoho_request_id'      => $zohoRequestId,
                    'status'               => $finalStatus,
                    'document_count'       => $orderedDocs->count(),
                    'document_ids'         => $sigReq->trade_doc_ids,
                    'document_names'       => $sigReq->document_names,
                    'signers'              => $sigReq->signers,
                    'expiry_date'          => $sigReq->expiry_date,
                    'auto_submitted'       => $submitted,
                    'testing_mode'         => $this->zoho->isTestingMode(),
                ],
            ]);
        } catch (\Throwable $e) {
            Log::error('CLM signature send failed', [
                'error'   => $e->getMessage(),
                'trace'   => $e->getTraceAsString(),
                'request' => $request->except(['signers']),
            ]);
            return response()->json(['status' => false, 'message' => 'Failed to send documents: ' . $e->getMessage()], 500);
        } finally {
            foreach ($tempPaths as $p) { @unlink($p); }
        }
    }

    /* ─────────────────────── LIST / SHOW ─────────────────────── */

    public function index(Request $request)
    {
        $user = $request->user(); if (!$user) abort(401);

        // Same-as-customer read-through: a consignee flagged
        // `same_as_customer = true` has no signature requests of its own —
        // its Stage 3 Trade Documents tab needs to surface the linked
        // customer's signed PDFs (and any inprogress requests) as if they
        // were the consignee's. Swap the (party_id, model_name) filter
        // before the where() clauses so the rest of the pipeline (status,
        // sync polling, fetchSignedArtifacts) operates uniformly.
        $filterPartyId   = $request->filled('party_id')   ? (int) $request->party_id : null;
        $filterModelName = $request->filled('model_name') ? (string) $request->model_name : null;
        if ($filterPartyId && $filterModelName === 'Consignee') {
            $consignee = Consignee::query()->find($filterPartyId);
            if ($consignee
                && $consignee->same_as_customer
                && $consignee->customer_id
                && (!$user->client_id || (int) ($consignee->client_id ?? 0) === (int) $user->client_id)
            ) {
                $filterPartyId   = (int) $consignee->customer_id;
                $filterModelName = 'Customer';
            }
        }

        $q = ClmSignatureRequest::query()->forUser($user)->latest();

        if ($filterPartyId)   $q->where('party_id', $filterPartyId);
        if ($filterModelName) $q->where('model_name', $filterModelName);
        if ($request->filled('status')) {
            $statuses = is_array($request->status) ? $request->status : [$request->status];
            $q->whereIn('status', $statuses);
        }

        $rows = $q->limit(200)->get();

        // Polling-mode refresh — when the caller passes ?sync=true (the
        // Stage 3 Trade Documents tab does this every 15s), iterate any
        // still-`inprogress` rows and pull their live status from Zoho.
        // Newly-completed rows trigger a one-shot signed-PDF + certificate
        // download so the next list response carries the artefact paths.
        if ($request->boolean('sync') && $this->zoho->isConfigured()) {
            $changed = false;
            foreach ($rows as $row) {
                if ($row->status !== 'inprogress' || !$row->zoho_request_id) continue;
                try {
                    $details = $this->zoho->getRequest($row->zoho_request_id);
                    $newStatus = strtolower((string) data_get($details, 'requests.request_status', $row->status));
                    if ($newStatus !== $row->status) {
                        $row->status = $newStatus;
                        if ($newStatus === 'completed' && !$row->completed_at) {
                            $row->completed_at = now();
                        }
                        $row->save();
                        $changed = true;
                        if ($newStatus === 'completed') {
                            $this->fetchSignedArtifacts($row, $details);
                        }
                    }
                } catch (\Throwable $e) {
                    Log::warning("Zoho sync skipped for sig request {$row->id}: " . $e->getMessage());
                }
            }
            if ($changed) {
                $rows = $q->limit(200)->get();
            }
        }

        return response()->json(['status' => true, 'data' => $rows, 'count' => $rows->count()]);
    }

    /**
     * Sync status from Zoho. When the request has just completed, this is
     * also the point at which we pull the signed PDFs + completion
     * certificate down into local storage.
     */
    public function show(Request $request, $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $row  = ClmSignatureRequest::query()->forUser($user)->findOrFail($id);

        try {
            $details   = $this->zoho->getRequest($row->zoho_request_id);
            $zohoState = strtolower((string) data_get($details, 'requests.request_status', $row->status));

            if ($zohoState !== $row->status) {
                $row->status = $zohoState;
                if ($zohoState === 'completed' && !$row->completed_at) {
                    $row->completed_at = now();
                }
                $row->save();

                if ($zohoState === 'completed') {
                    $this->fetchSignedArtifacts($row, $details);
                }
            }
        } catch (\Throwable $e) {
            Log::warning('Zoho status sync failed: ' . $e->getMessage());
        }

        return response()->json([
            'status' => true,
            'data'   => $row->fresh(),
        ]);
    }

    public function remind(Request $request, $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $row  = ClmSignatureRequest::query()->forUser($user)->findOrFail($id);

        try {
            $live   = $this->zoho->getRequest($row->zoho_request_id);
            $state  = strtolower((string) data_get($live, 'requests.request_status', $row->status));
            if ($state !== $row->status) { $row->status = $state; $row->save(); }
            if ($state !== 'inprogress') {
                return response()->json(['status' => false, 'message' => "Reminder cannot be sent. Current status is '{$state}'."], 400);
            }

            $resp = $this->zoho->remind($row->zoho_request_id);
            $row->last_reminder_sent_at = now();
            $row->reminder_count        = (int) $row->reminder_count + 1;
            $row->save();

            return response()->json(['status' => true, 'message' => 'Reminder sent', 'data' => $resp]);
        } catch (\Throwable $e) {
            return response()->json(['status' => false, 'message' => 'Failed to send reminder: ' . $e->getMessage()], 500);
        }
    }

    public function recall(Request $request, $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $data = $request->validate(['reason' => 'required|string|max:500']);
        $row  = ClmSignatureRequest::query()->forUser($user)->findOrFail($id);

        if ($row->status === 'completed') {
            return response()->json(['status' => false, 'message' => 'Cannot recall a completed document'], 400);
        }

        try {
            $resp = $this->zoho->recall($row->zoho_request_id, $data['reason']);
            $row->status        = 'recalled';
            $row->recalled_at   = now();
            $row->recall_reason = $data['reason'];
            $row->save();
            return response()->json(['status' => true, 'message' => 'Recalled', 'data' => $resp]);
        } catch (\Throwable $e) {
            return response()->json(['status' => false, 'message' => 'Failed to recall: ' . $e->getMessage()], 500);
        }
    }

    /* ─────────────────────── Signed-file streaming ─────────────────────── */

    public function downloadFile(Request $request, $id, $index)
    {
        return $this->streamSignedFile($request, $id, (int) $index, 'attachment');
    }

    public function viewFile(Request $request, $id, $index)
    {
        return $this->streamSignedFile($request, $id, (int) $index, 'inline');
    }

    private function streamSignedFile(Request $request, $id, int $index, string $disposition)
    {
        $user = $request->user(); if (!$user) abort(401);
        $row  = ClmSignatureRequest::query()->forUser($user)->findOrFail($id);

        $paths = is_array($row->signed_document_paths) ? $row->signed_document_paths : [];
        if (empty($paths)) {
            // Lazy-pull from Zoho if the row says completed but local files are missing.
            if ($row->status === 'completed') {
                $details = $this->zoho->getRequest($row->zoho_request_id);
                $this->fetchSignedArtifacts($row, $details);
                $row->refresh();
                $paths = is_array($row->signed_document_paths) ? $row->signed_document_paths : [];
            }
        }

        $entry = $paths[$index] ?? null;
        $path  = is_array($entry) ? ($entry['path'] ?? null) : null;

        if (!$path || !Storage::disk('public')->exists($path)) {
            return response()->json(['status' => false, 'message' => 'Signed document not found'], 404);
        }

        return response(Storage::disk('public')->get($path), 200, [
            'Content-Type'        => 'application/pdf',
            'Content-Disposition' => $disposition . '; filename="' . basename($path) . '"',
        ]);
    }

    public function viewCertificate(Request $request, $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $row  = ClmSignatureRequest::query()->forUser($user)->findOrFail($id);

        $path = $row->certificate_path;
        if ((!$path || !Storage::disk('public')->exists($path)) && $row->status === 'completed') {
            $details = $this->zoho->getRequest($row->zoho_request_id);
            $this->fetchSignedArtifacts($row, $details);
            $row->refresh();
            $path = $row->certificate_path;
        }

        if (!$path || !Storage::disk('public')->exists($path)) {
            return response()->json(['status' => false, 'message' => 'Certificate not available'], 404);
        }

        return response(Storage::disk('public')->get($path), 200, [
            'Content-Type'        => 'application/pdf',
            'Content-Disposition' => 'inline; filename="' . basename($path) . '"',
        ]);
    }

    /* ─────────────────────── Helpers ─────────────────────── */

    /**
     * Render a single ClmTradeDocLibrary draft into a DomPDF instance with
     * the customer's data merged into placeholder tokens. Centralised so
     * preview + send go through identical rendering.
     */
    private function renderPdf(
        ClmTradeDocLibrary $doc,
        Model $party,
        string $modelName,
        string $requestUuid,
        ?array $signers = null,
        ?array $headerOverride = null,
        ?array $footerOverride = null,
        ?string $contentOverride = null,
    ) {
        // Content override takes precedence over the row's saved HTML —
        // used by the Send-for-Signature modal when the user pastes in
        // a table via Insert Table or otherwise edits the body inline.
        $sourceHtml    = $contentOverride !== null ? $contentOverride : (string) $doc->content;
        $processedHtml = $this->replacePlaceholders($sourceHtml, $party, $modelName);
        $client = Client::find($doc->client_id);

        // Saved Stage 2 page-shell config — drives the PDF's header/footer
        // so the user's draft preview matches what gets sent. Cast pulls
        // them back as arrays from the JSON column; missing on legacy
        // rows → null (blade falls back to a minimal client-name header
        // so older drafts still render).
        //
        // Per-render overrides win when present. The Send-for-Signature
        // modal POSTs an in-progress header/footer config alongside the
        // preview/send call so the user's inline tweaks render without
        // mutating the saved row.
        $headerConfig = is_array($headerOverride) ? $headerOverride
            : (is_array($doc->header_config) ? $doc->header_config : []);
        $footerConfig = is_array($footerOverride) ? $footerOverride
            : (is_array($doc->footer_config) ? $doc->footer_config : []);

        // dompdf can't fetch /storage URLs at render time, so resolve the
        // saved header logo to a base64 data URL up-front. Prefer the
        // per-doc header logo the user uploaded via HeaderFooterPanel.
        // Fall back to the URL-encoded variant (rows seeded from /me's
        // branch_logo only carry `logo_url`, not `logo_path`), then to
        // the tenant client's branding logo for true legacy rows.
        $headerLogoBase64 = $this->resolveLogoBase64(
            $headerConfig['logo_path'] ?? null,
            $this->pathFromStorageUrl($headerConfig['logo_url'] ?? null),
            $client?->logo,
        );

        return Pdf::loadView('pdf.clm-signature-document', [
            'document'         => $doc,
            'party'            => $party,
            'modelName'        => $modelName,
            'processedHtml'    => $processedHtml,
            'generatedDate'    => now()->format('d/m/Y'),
            'requestId'        => substr($requestUuid, 0, 8),
            'signers'          => $signers ?? [],
            'client'           => $client,
            'headerConfig'     => $headerConfig,
            'footerConfig'     => $footerConfig,
            'headerLogoBase64' => $headerLogoBase64,
        ])->setPaper('a4');
    }

    /**
     * Walk candidate storage paths in priority order and return the
     * first one that resolves to a file on the public disk, base64-
     * encoded for inline embedding in the PDF. Returns '' when none of
     * them resolve, so the blade renders a text-only header band.
     */
    private function resolveLogoBase64(?string ...$candidates): string
    {
        foreach ($candidates as $path) {
            if (!$path) continue;
            try {
                if (\Illuminate\Support\Facades\Storage::disk('public')->exists($path)) {
                    return base64_encode(\Illuminate\Support\Facades\Storage::disk('public')->get($path));
                }
            } catch (\Throwable $e) {
                // try the next candidate
            }
        }
        return '';
    }

    /**
     * Pull the storage-relative path out of a public-disk URL. Accepts
     * both `/storage/foo/bar.png` and `https://example.com/storage/foo/bar.png`
     * forms — anything after the first `/storage/` segment is the
     * storage-relative path on the public disk. Used so existing trade-doc
     * rows seeded from /me's branch_logo (URL only, no path) still render
     * their logo in the PDF.
     */
    private function pathFromStorageUrl(?string $url): ?string
    {
        if (!$url) return null;
        if (preg_match('#/storage/(.+)$#', $url, $m)) {
            return $m[1];
        }
        return null;
    }

    /**
     * Replace the {{customer.*}} / {{consignee.*}} / {{supplier.*}} tokens
     * the [[ClmInsertPlaceholderModal]] picker writes into the draft.
     *
     * Only the token namespace matching the request's $modelName is
     * resolved from real data — the other two stay literal so they're
     * visible to the human reviewer (and obvious when the wrong template
     * is paired with the wrong party). The signature tokens for ALL
     * three parties always become sig-boxes since visual placement is
     * independent of which signer actually completes them.
     *
     * Customer / Consignee / Vendor share the same shape (company_name,
     * primary_email, primaryAddress with cp_*), so a single resolver
     * over the relevant party works for all three.
     */
    private function replacePlaceholders(string $html, Model $party, string $modelName): string
    {
        if ($html === '') return '<p></p>';

        // Maps the Eloquent class to the token-namespace prefix the draft
        // editor uses. Vendor → supplier matches the ClmInsertPlaceholderModal
        // picker (the user-facing label is "Supplier", the model is "Vendor").
        $partyToTokenNs = ['Customer' => 'customer', 'Consignee' => 'consignee', 'Vendor' => 'supplier'];
        $ns = $partyToTokenNs[$modelName] ?? null;

        if ($ns) {
            $addr = $party->primaryAddress;   // null-safe via PHP 8 ?->
            $addressLine = trim(implode(', ', array_filter([
                $addr?->address_line, $addr?->city, $addr?->state, $addr?->country, $addr?->pin,
            ])));

            $codeAttr = $modelName === 'Customer'  ? 'customer_code'
                      : ($modelName === 'Consignee' ? 'consignee_code'
                      : 'vendor_code');

            $map = [
                '{{' . $ns . '.name}}'            => e($party->company_name ?? ''),
                '{{' . $ns . '.code}}'            => e($party->{$codeAttr} ?? ''),
                '{{' . $ns . '.company}}'         => e(($party->legal_name ?: $party->company_name) ?? ''),
                '{{' . $ns . '.contact_person}}'  => e($addr?->cp_name ?? ''),
                '{{' . $ns . '.phone}}'           => e($addr?->cp_contact ?? ''),
                '{{' . $ns . '.email}}'           => e($party->primary_email ?? ''),
                '{{' . $ns . '.country}}'         => e($addr?->country ?? ''),
                '{{' . $ns . '.address}}'         => e($addressLine),
                '{{' . $ns . '.gst}}'             => '',
                '{{' . $ns . '.pan}}'             => '',
                '{{' . $ns . '.iec}}'             => '',
            ];

            $html = strtr($html, $map);
        }

        // Signature placeholders — every party variant becomes a styled
        // sig-box. The unique invisible marker (rendered at 0.5pt in a
        // near-white colour) is picked up by the frontend PDF.js detector
        // so it can use the placeholder's rendered position as the default
        // for the draggable signature overlay. Zoho's real signature
        // widget is positioned by the (x, y, page) coords in the submit
        // payload — the box here is purely visual + detection scaffolding.
        foreach (['customer', 'consignee', 'supplier'] as $party) {
            $token  = self::sigMarkerToken($party);
            $sigBox = '<div class="sig-box">'
                    . '<span class="sig-marker">' . $token . '</span>'
                    . '[ Signature ]'
                    . '</div>';
            $html = str_replace('{{' . $party . '.signature}}', $sigBox, $html);
        }

        return $html;
    }

    /**
     * Unique marker text embedded inside each signature placeholder. The
     * frontend's PDF.js detector greps each page's text content for these
     * tokens to figure out the rendered coordinates of every sig-box and
     * uses them as the default signature-field position per party.
     *
     * Format chosen to be vanishingly unlikely to appear in user-typed
     * draft content (double-guillemets + uppercase party slug + numeric
     * salt). Kept as a small constant so the PHP side and the JS regex
     * stay aligned — see SIG_MARKER_REGEX in SalesCustomerSendForSignatureModal.
     */
    public static function sigMarkerToken(string $party): string
    {
        return '«CBC-SIG-' . strtoupper($party) . '-9417»';
    }

    /**
     * The frontend keys document_settings by CBC's clm_trade_doc_library.id,
     * but the Zoho submit payload wants the Zoho-side document_id. This
     * walks the parallel arrays (same order, guaranteed by how we built
     * the createRequestMultipart() call) and rewrites the map.
     *
     * @param  array<int|string, array{x?:float, y?:float, page?:int, width?:float, height?:float}>  $clientMap
     * @param  array<int, int>     $cbcDocIdsOrdered
     * @param  array<int, array{document_id?:string}>  $zohoDocsOrdered
     * @return array<string, array<string, float|int>>
     */
    private function mapClientCoordsToZohoDocIds(array $clientMap, array $cbcDocIdsOrdered, array $zohoDocsOrdered): array
    {
        $out = [];
        foreach ($cbcDocIdsOrdered as $i => $cbcId) {
            $zohoId = $zohoDocsOrdered[$i]['document_id'] ?? null;
            if (!$zohoId) continue;
            $settings = $clientMap[$cbcId] ?? $clientMap[(string) $cbcId] ?? null;
            if (is_array($settings)) {
                $out[$zohoId] = $settings;
            }
        }
        return $out;
    }

    /**
     * Pull every signed PDF + the completion certificate from Zoho into
     * Storage::disk('public') and update the row's path columns. Called
     * lazily — show()/viewFile()/viewCertificate() all converge here.
     */
    private function fetchSignedArtifacts(ClmSignatureRequest $row, array $details): void
    {
        $modelFolder = strtolower($row->model_name);
        $basePath    = 'uploads/signed_documents/' . $modelFolder;
        if (!Storage::disk('public')->exists($basePath)) {
            Storage::disk('public')->makeDirectory($basePath);
        }

        $zohoDocs   = data_get($details, 'requests.document_ids', []);
        $savedPaths = [];
        $zohoIds    = [];

        foreach ($zohoDocs as $i => $doc) {
            $zohoId = $doc['document_id'] ?? null;
            $name   = $doc['document_name'] ?? ('document_' . ($i + 1));
            if (!$zohoId) continue;
            $zohoIds[] = $zohoId;

            try {
                $bytes = $this->zoho->downloadDocumentPdf($row->zoho_request_id, $zohoId);
                $safe  = Str::slug(pathinfo((string) $name, PATHINFO_FILENAME)) ?: ('document_' . ($i + 1));
                $fileName = sprintf('signed_%s_%d_%d.pdf', $safe, time(), $i);
                $path  = $basePath . '/' . $fileName;
                Storage::disk('public')->put($path, $bytes);
                $savedPaths[] = [
                    'zoho_document_id' => $zohoId,
                    'document_name'    => $name,
                    'path'             => $path,
                    'url'              => Storage::disk('public')->url($path),
                ];
            } catch (\Throwable $e) {
                Log::warning("Skipped signed doc {$zohoId}: " . $e->getMessage());
            }
        }

        if (!empty($savedPaths)) {
            $row->zoho_document_ids      = $zohoIds;
            $row->signed_document_paths  = $savedPaths;
            $row->signed_document_path   = $savedPaths[0]['path'] ?? null;
        }

        // Completion certificate is always one per request.
        try {
            $cert = $this->zoho->downloadCertificate($row->zoho_request_id);
            $safe = Str::slug($row->request_name) ?: 'request';
            $certPath = $basePath . '/' . sprintf('certificate_%s_%d.pdf', $safe, time());
            Storage::disk('public')->put($certPath, $cert);
            $row->certificate_path = $certPath;
        } catch (\Throwable $e) {
            Log::warning('Certificate fetch failed: ' . $e->getMessage());
        }

        $row->save();
    }
}
