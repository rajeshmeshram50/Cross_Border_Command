<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Branch;
use App\Models\Client;
use App\Models\ClmAgreementLibrary;
use App\Models\ClmSignatureRequest;
use App\Models\ClmTradeDocLibrary;
use App\Models\Consignee;
use App\Models\CtcContract;
use App\Models\Customer;
use App\Models\Lead;
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


    public function preview(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);

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
            $doc,
            $party,
            $modelName,
            Str::uuid()->toString(),
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


    private function loadParty(string $modelName, int $partyId, $user): Model
    {
        switch ($modelName) {
            case 'Customer':
                return Customer::query()->forUser($user)->findOrFail($partyId);
            case 'Consignee':
                return Consignee::query()->forUser($user)->findOrFail($partyId);
            case 'Vendor':
                return Vendor::query()->forUser($user)->findOrFail($partyId);
        }
        abort(422, "Unsupported model_name: {$modelName}");
    }



    public function send(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);
        if (!$user->client_id) return response()->json(['status' => false, 'message' => 'No tenant context'], 403);

        if (!$this->zoho->isConfigured()) {
            return response()->json(['status' => false, 'message' => 'Zoho Sign is not configured. Contact your administrator.'], 503);
        }

        $data = $request->validate([
            'trade_doc_ids'        => 'required|array|min:1|max:10',
            'trade_doc_ids.*'      => 'integer|exists:clm_trade_doc_library,id',
            'party_id'             => 'required|integer',
            'model_name'           => 'nullable|string|in:Customer,Consignee,Vendor',
            // Optional lead scope. Sent from the Sales-Matrix Trade Documents
            // popup so the request is tied to the opportunity — without it the
            // lead-scoped status lookup/poll (and the row's Sent/Signed badge,
            // Remind + downloads) can't find it. Omitted for the standalone
            // customer/consignee/vendor vault sends.
            'lead_id'              => 'nullable|integer|exists:leads,id',
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
            ->map(fn($id) => $docs->get($id))
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
                    $doc,
                    $party,
                    $modelName,
                    $requestUuid,
                    $data['signers'],
                    $headerOverride,
                    $footerOverride,
                    $contentOver,
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

            $filenames = array_map(fn($m) => Str::slug($m['document_name']) ?: ('document_' . $m['id']), $localDocMeta);

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
            // Explicit trade-doc discriminator + optional lead scope so the
            // Sales-Matrix popup can resolve this request lead-side (mirrors
            // the agreement-send path).
            $sigReq->document_type       = ClmSignatureRequest::DOC_TRADE;
            $sigReq->lead_id             = $data['lead_id'] ?? null;
            $sigReq->trade_doc_id        = $orderedDocs->first()->id;
            $sigReq->trade_doc_ids       = $orderedDocs->pluck('id')->values()->all();
            $sigReq->document_names      = collect($localDocMeta)->pluck('document_name')->values()->all();
            $sigReq->zoho_document_ids   = array_values(array_filter(array_map(fn($d) => $d['document_id'] ?? null, $zohoDocumentIds)));
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
            foreach ($tempPaths as $p) {
                @unlink($p);
            }
        }
    }



    public function agreementPreview(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $data = $request->validate([
            'agreement_id'            => 'required|integer|exists:clm_agreement_library,id',
            'lead_id'                 => 'required|integer|exists:leads,id',
            /* Per-send page-shell + body overrides — let the workplace
             * Send-for-Signature flow tweak the agreement's header,
             * footer and body content without mutating the saved row.
             * Identical shape to the trade-doc preview override path. */
            'header_config_override'  => 'nullable|array',
            'footer_config_override'  => 'nullable|array',
            'content_override'        => 'nullable|string',
        ]);

        $agreement = ClmAgreementLibrary::where('client_id', $user->client_id)
            ->findOrFail($data['agreement_id']);
        $lead = Lead::where('client_id', $user->client_id)->findOrFail($data['lead_id']);

        // Resolve the primary party for placeholder replacement — buyer
        // always wins when present, otherwise consignee. Suppliers aren't
        // in the lead-side flow.
        [$primary, $primaryModel, $signers, $allParties] = $this->resolveAgreementSigners($agreement, $lead, $user);

        if (!$primary) {
            return response()->json(['status' => false, 'message' => 'No customer/consignee on this lead to render the agreement against.'], 422);
        }

        // Diagnostic log — written every preview so the operator can
        // confirm in storage/logs/laravel.log which parties got resolved
        // and whether the agreement body actually contains tokens to
        // substitute. Compact form: agreement + lead + party ids, plus
        // a flag for whether the body had ANY `{{` placeholders.
        Log::info('agreement.preview', [
            'agreement_id'   => $agreement->id,
            'agreement_code' => $agreement->code,
            'lead_id'        => $lead->id,
            'lead_customer_id'  => $lead->customer_id,
            'lead_consignee_id' => $lead->consignee_id,
            'primary'        => [$primaryModel, $primary->id ?? null, $primary->company_name ?? null],
            'all_parties'    => collect($allParties)->map(fn($p, $k) => [$k, $p->id, $p->company_name])->values()->all(),
            'body_has_tokens' => str_contains((string) $agreement->content, '{{'),
        ]);

        $pdf = $this->renderAgreementPdf(
            $agreement,
            $primary,
            $primaryModel,
            Str::uuid()->toString(),
            $signers,
            $data['header_config_override'] ?? null,
            $data['footer_config_override'] ?? null,
            array_key_exists('content_override', $data) ? (string) $data['content_override'] : null,
            $allParties,
        );

        return response($pdf->output(), 200, [
            'Content-Type'        => 'application/pdf',
            'Content-Disposition' => 'inline; filename="preview-' . ($agreement->code ?: $agreement->id) . '.pdf"',
            'Cache-Control'       => 'no-store',
        ]);
    }

    public function agreementSend(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);
        if (!$user->client_id) return response()->json(['status' => false, 'message' => 'No tenant context'], 403);

        if (!$this->zoho->isConfigured()) {
            return response()->json(['status' => false, 'message' => 'Zoho Sign is not configured. Contact your administrator.'], 503);
        }

        $data = $request->validate([
            // Bulk-aware: callers can pass `agreement_ids[]` for a bulk send,
            // or the legacy single `agreement_id` for one-shot. Both end up
            // normalised into $ids below.
            'agreement_id'      => 'nullable|integer|exists:clm_agreement_library,id',
            'agreement_ids'     => 'nullable|array|min:1|max:10',
            'agreement_ids.*'   => 'integer|exists:clm_agreement_library,id',
            'lead_id'           => 'required|integer|exists:leads,id',
            'expiry_days'       => 'nullable|integer|min:1|max:180',
            'is_sequential'     => 'nullable|boolean',
            'notes'             => 'nullable|string|max:1000',
            /* Per-doc signature placement keyed by agreement_id →
             * { x, y, page, width, height }. Single map covers both
             * single + bulk sends. mapClientCoordsToZohoDocIds expands
             * it into per-Zoho-doc field entries. */
            'document_settings' => 'nullable|array',
            /* Per-doc page-shell + body overrides keyed by agreement_id.
             * Mirrors the trade-doc send override path so each agreement
             * in a bulk send can carry its own brand band + body edits
             * without mutating the saved row. */
            'header_config_overrides'   => 'nullable|array',
            'footer_config_overrides'   => 'nullable|array',
            'content_overrides'         => 'nullable|array',
        ]);

        // Normalise the input — frontend may pass `agreement_ids` (bulk)
        // or `agreement_id` (single). Either path lands in an ordered
        // unique int[] preserving caller order.
        $rawIds = !empty($data['agreement_ids'])
            ? array_map('intval', $data['agreement_ids'])
            : (!empty($data['agreement_id']) ? [(int) $data['agreement_id']] : []);
        $ids = array_values(array_unique(array_filter($rawIds, fn($v) => $v > 0)));
        if (empty($ids)) {
            return response()->json(['status' => false, 'message' => 'No agreement_ids supplied'], 422);
        }

        $lead       = Lead::where('client_id', $user->client_id)->findOrFail($data['lead_id']);
        $agreements = ClmAgreementLibrary::where('client_id', $user->client_id)
            ->whereIn('id', $ids)
            ->get()
            ->keyBy('id');

        if ($agreements->isEmpty()) {
            return response()->json(['status' => false, 'message' => 'No accessible agreements in the selection.'], 422);
        }

        // Preserve caller order (DB returns rows in arbitrary order).
        $orderedAgreements = collect($ids)
            ->map(fn($id) => $agreements->get($id))
            ->filter()
            ->values();

        // Same-party constraint — every selected agreement must have an
        // identical applicable_party CSV so the signer list resolves
        // consistently across the bundle. Whitespace + casing are
        // normalised before comparison so "Buyer, Consignee" and
        // "buyer,consignee" group together.
        $normaliseParty = function (?string $p): string {
            return collect(explode(',', (string) $p))
                ->map(fn($s) => strtolower(trim($s)))
                ->filter()
                ->sort()
                ->values()
                ->implode(',');
        };
        $partyKeys = $orderedAgreements->map(fn($a) => $normaliseParty($a->party))->unique()->values();
        if ($partyKeys->count() > 1) {
            return response()->json([
                'status'  => false,
                'message' => 'Bulk send requires every selected agreement to share the same applicable party. Found: '
                    . $orderedAgreements->pluck('party')->unique()->implode(' | '),
            ], 422);
        }

        // Resolve signers from the first agreement (same party for all
        // selected, so signer composition is identical).
        $headAgreement = $orderedAgreements->first();
        [$primary, $primaryModel, $signers, $allParties] = $this->resolveAgreementSigners($headAgreement, $lead, $user);

        if (!$primary || empty($signers)) {
            return response()->json([
                'status'  => false,
                'message' => 'No signer could be resolved — the agreement\'s applicable party (' . $headAgreement->party . ') does not match a customer/consignee on this lead.',
            ], 422);
        }

        $requestUuid  = (string) Str::uuid();
        $tempPaths    = [];
        $localDocMeta = [];

        // Per-agreement overrides — keys can arrive as ints or numeric
        // strings depending on how the JSON object was serialised, so
        // we look up by both forms.
        $headerOverrides  = (array) ($data['header_config_overrides'] ?? []);
        $footerOverrides  = (array) ($data['footer_config_overrides'] ?? []);
        $contentOverrides = (array) ($data['content_overrides']       ?? []);
        $pickOverride = function (array $bag, int $aid) {
            return $bag[$aid] ?? $bag[(string) $aid] ?? null;
        };

        try {
            // 1. Render every agreement to a temp PDF.
            foreach ($orderedAgreements as $a) {
                $headerOverride  = $pickOverride($headerOverrides,  $a->id);
                $footerOverride  = $pickOverride($footerOverrides,  $a->id);
                $contentOverride = $pickOverride($contentOverrides, $a->id);
                $pdf = $this->renderAgreementPdf(
                    $a,
                    $primary,
                    $primaryModel,
                    $requestUuid,
                    $signers,
                    is_array($headerOverride) ? $headerOverride : null,
                    is_array($footerOverride) ? $footerOverride : null,
                    $contentOverride !== null ? (string) $contentOverride : null,
                    $allParties,
                );
                $tmp = storage_path('app/temp/' . Str::uuid()->toString() . '.pdf');
                file_put_contents($tmp, $pdf->output());
                $tempPaths[]    = $tmp;
                $localDocMeta[] = [
                    'id'            => $a->id,
                    'document_name' => $a->code ? "{$a->code} {$a->title}" : $a->title,
                ];
            }

            // 2. Build Zoho request payload.
            $expiryDays = (int) ($data['expiry_days'] ?? 30);
            $actions = [];
            foreach ($signers as $i => $signer) {
                $actions[] = [
                    'recipient_email'  => $signer['email'],
                    'recipient_name'   => $signer['name'],
                    'action_type'      => 'SIGN',
                    'signing_order'    => $signer['order'] ?? ($i + 1),
                    'verify_recipient' => false,
                ];
            }

            $requestName = $orderedAgreements->count() > 1
                ? 'Agreements: ' . $orderedAgreements->pluck('title')->take(3)->implode(', ')
                . ($orderedAgreements->count() > 3 ? '…' : '')
                : (string) $headAgreement->title;

            $requestBody = [
                'requests' => [
                    'request_name'    => $requestName,
                    'is_sequential'   => (bool) ($data['is_sequential'] ?? false),
                    'expiration_days' => $expiryDays,
                    'notes'           => (string) ($data['notes'] ?? 'Please review and sign these agreements.'),
                    'actions'         => $actions,
                ],
            ];

            $filenames = array_map(fn($m) => Str::slug($m['document_name']) ?: ('agreement_' . $m['id']), $localDocMeta);

            // 3. Create Zoho request (multipart — JSON + N PDFs).
            $createResp    = $this->zoho->createRequestMultipart($tempPaths, $filenames, $requestBody);
            $zohoRequestId = data_get($createResp, 'requests.request_id');
            if (!$zohoRequestId) {
                throw new RuntimeException('Zoho create-request did not return a request_id: ' . json_encode($createResp));
            }

            // 4. Fetch the created request and submit with signature fields.
            $details         = $this->zoho->getRequest($zohoRequestId);
            $zohoActions     = data_get($details, 'requests.actions',      []);
            $zohoDocumentIds = data_get($details, 'requests.document_ids', []);

            // Tag each Zoho action with the CBC signer role (buyer /
            // consignee) by matching its recipient_email against our
            // resolved $signers list. submitWithFields uses `cbc_role`
            // to look up per-signer coords on multi-party agreements
            // (e.g. Buyer + Consignee), so each signer's signature box
            // lands at the position the user dragged for THAT role —
            // rather than every signer sharing one coord and visually
            // stacking on top of each other.
            $signersByEmail = collect($signers)
                ->keyBy(fn($s) => strtolower((string) ($s['email'] ?? '')));
            foreach ($zohoActions as &$zohoAction) {
                $email = strtolower((string) ($zohoAction['recipient_email'] ?? ''));
                $match = $signersByEmail->get($email);
                if (is_array($match) && !empty($match['role'])) {
                    $zohoAction['cbc_role'] = (string) $match['role'];
                }
            }
            unset($zohoAction);

            $perDocCoords = $this->mapClientCoordsToZohoDocIds(
                (array) ($data['document_settings'] ?? []),
                $orderedAgreements->pluck('id')->all(),
                $zohoDocumentIds
            );

            $submitResp = $this->zoho->submitWithFields($zohoRequestId, $zohoActions, $zohoDocumentIds, $perDocCoords);
            $submitted  = isset($submitResp['requests']);

            // 5. Read back final status.
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

            // 6. Persist. `trade_doc_id`/`trade_doc_ids` reuse for agreement
            //    ids — the polymorphic discriminator is `document_type`.
            $sigReq = new ClmSignatureRequest();
            $sigReq->client_id         = $user->client_id;
            $sigReq->branch_id         = $user->branch_id ?? null;
            $sigReq->document_type     = ClmSignatureRequest::DOC_AGREEMENT;
            $sigReq->lead_id           = $lead->id;
            $sigReq->trade_doc_id      = $orderedAgreements->first()->id;
            $sigReq->trade_doc_ids     = $orderedAgreements->pluck('id')->values()->all();
            $sigReq->document_names    = collect($localDocMeta)->pluck('document_name')->values()->all();
            $sigReq->zoho_document_ids = array_values(array_filter(array_map(fn($d) => $d['document_id'] ?? null, $zohoDocumentIds)));
            $sigReq->model_name        = $primaryModel;
            $sigReq->party_id          = $primary->id;
            $sigReq->zoho_request_id   = $zohoRequestId;
            $sigReq->request_name      = $requestName;
            $sigReq->status            = $finalStatus;
            $sigReq->signers           = $signers;
            $sigReq->expiry_date       = now()->addDays($expiryDays);
            $sigReq->metadata          = [
                'sent_at'             => now()->toIso8601String(),
                'document_type'       => 'agreement',
                'is_bulk'             => $orderedAgreements->count() > 1,
                'agreement_ids'       => $orderedAgreements->pluck('id')->values()->all(),
                'agreement_codes'     => $orderedAgreements->pluck('code')->values()->all(),
                'agreement_party'     => $headAgreement->party,
                'agreement_segments'  => $orderedAgreements->pluck('segment')->unique()->values()->all(),
                'lead_id'             => $lead->id,
                'primary_party'       => [
                    'model' => $primaryModel,
                    'id'    => $primary->id,
                    'name'  => $primary->company_name ?? null,
                    'email' => $primary->primary_email ?? null,
                ],
                'document_settings'   => $data['document_settings'] ?? null,
                'request_uuid'        => $requestUuid,
            ];
            $sigReq->created_by = Auth::id();
            $sigReq->save();

            $isBulk = $orderedAgreements->count() > 1;
            $message = $finalStatus === 'inprogress'
                ? ($isBulk
                    ? $orderedAgreements->count() . ' agreements sent for signature successfully.'
                    : 'Agreement sent for signature successfully.')
                : 'Agreement created in Zoho but submission did not flip to inprogress.';
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
                    'agreement_ids'        => $sigReq->trade_doc_ids,
                    'document_names'       => $sigReq->document_names,
                    'document_count'       => $orderedAgreements->count(),
                    'signers'              => $sigReq->signers,
                    'expiry_date'          => $sigReq->expiry_date,
                    'auto_submitted'       => $submitted,
                    'testing_mode'         => $this->zoho->isTestingMode(),
                ],
            ]);
        } catch (\Throwable $e) {
            Log::error('CLM agreement send failed', [
                'error'   => $e->getMessage(),
                'trace'   => $e->getTraceAsString(),
                'request' => $request->all(),
            ]);
            return response()->json(['status' => false, 'message' => 'Failed to send agreement: ' . $e->getMessage()], 500);
        } finally {
            foreach ($tempPaths as $p) {
                @unlink($p);
            }
        }
    }

    /* ─────────────────────────────────────────────────────────────────────
     * CTC (Case-to-Case Contract) → Send for Signature & Negotiation.
     *
     * Mirrors agreementSend(): renders the CTC contract body to a PDF and
     * ships it to Zoho Sign for the chosen counterparty contact persons.
     * Each signer gets a Signature field at the coordinates the user dragged
     * in the preview (document_settings keyed by contract id → per-signer
     * coords). The receiving-party {{signature}} placeholder is auto-filled
     * with the branch signature + stamp. On success the contract advances to
     * Stage 3 with a signing_recipients tracker linked to the Zoho request.
     * ───────────────────────────────────────────────────────────────────── */

    public function ctcPreview(Request $request)
    {
        $user = $request->user(); if (!$user) abort(401);
        $data = $request->validate([
            'contract_id'            => 'required|integer',
            'header_config_override' => 'nullable|array',
            'footer_config_override' => 'nullable|array',
            'content_override'       => 'nullable|string',
        ]);
        $c = CtcContract::where('client_id', $user->client_id)->findOrFail($data['contract_id']);
        $pdf = $this->renderCtcPdf(
            $c, [],
            $data['header_config_override'] ?? null,
            $data['footer_config_override'] ?? null,
            array_key_exists('content_override', $data) ? (string) $data['content_override'] : null,
            Str::uuid()->toString(),
        );
        return response($pdf->output(), 200, [
            'Content-Type'        => 'application/pdf',
            'Content-Disposition' => 'inline; filename="ctc-preview-' . ($c->code ?: $c->id) . '.pdf"',
            'Cache-Control'       => 'no-store',
        ]);
    }

    public function ctcSend(Request $request)
    {
        $user = $request->user(); if (!$user) abort(401);
        if (!$user->client_id) return response()->json(['status' => false, 'message' => 'No tenant context'], 403);
        if (!$this->zoho->isConfigured()) {
            return response()->json(['status' => false, 'message' => 'Zoho Sign is not configured. Contact your administrator.'], 503);
        }

        $data = $request->validate([
            'contract_id'            => 'required|integer',
            'signers'                => 'required|array|min:1|max:10',
            'signers.*.name'         => 'required|string|max:255',
            'signers.*.email'        => 'required|email|max:255',
            'signers.*.role'         => 'nullable|string|max:64',
            'signers.*.order'        => 'nullable|integer',
            'expiry_days'            => 'nullable|integer|min:1|max:180',
            'is_sequential'          => 'nullable|boolean',
            'notes'                  => 'nullable|string|max:1000',
            'document_settings'      => 'nullable|array',
            'header_config_override' => 'nullable|array',
            'footer_config_override' => 'nullable|array',
            'content_override'       => 'nullable|string',
        ]);

        $c = CtcContract::where('client_id', $user->client_id)->findOrFail($data['contract_id']);

        // Stable per-signer role key (signer1, signer2, …) so submitWithFields
        // can place each signer's field at its own dragged position.
        $signers = [];
        foreach (array_values($data['signers']) as $i => $s) {
            $signers[] = [
                'name'  => (string) $s['name'],
                'email' => strtolower((string) $s['email']),
                'role'  => !empty($s['role']) ? (string) $s['role'] : ('signer' . ($i + 1)),
                'order' => (int) ($s['order'] ?? ($i + 1)),
            ];
        }

        $requestUuid = (string) Str::uuid();
        $tempPaths   = [];
        try {
            $pdf = $this->renderCtcPdf(
                $c, $signers,
                $data['header_config_override'] ?? null,
                $data['footer_config_override'] ?? null,
                array_key_exists('content_override', $data) ? (string) $data['content_override'] : null,
                $requestUuid,
            );
            $tmp = storage_path('app/temp/' . Str::uuid()->toString() . '.pdf');
            file_put_contents($tmp, $pdf->output());
            $tempPaths[] = $tmp;

            $expiryDays = (int) ($data['expiry_days'] ?? ($c->days_to_sign ?: 30));
            $actions = [];
            foreach ($signers as $i => $signer) {
                $actions[] = [
                    'recipient_email'  => $signer['email'],
                    'recipient_name'   => $signer['name'],
                    'action_type'      => 'SIGN',
                    'signing_order'    => $signer['order'] ?? ($i + 1),
                    'verify_recipient' => false,
                ];
            }
            $requestName = (string) ($c->title ?: ($c->code ?: 'CTC Agreement'));
            $requestBody = ['requests' => [
                'request_name'    => $requestName,
                'is_sequential'   => (bool) ($data['is_sequential'] ?? false),
                'expiration_days' => $expiryDays,
                'notes'           => (string) ($data['notes'] ?? 'Please review and sign this agreement.'),
                'actions'         => $actions,
            ]];
            $filenames = [Str::slug($requestName) ?: ('ctc_' . $c->id)];

            $createResp    = $this->zoho->createRequestMultipart($tempPaths, $filenames, $requestBody);
            $zohoRequestId = data_get($createResp, 'requests.request_id');
            if (!$zohoRequestId) throw new RuntimeException('Zoho create-request did not return a request_id: ' . json_encode($createResp));

            $details         = $this->zoho->getRequest($zohoRequestId);
            $zohoActions     = data_get($details, 'requests.actions',      []);
            $zohoDocumentIds = data_get($details, 'requests.document_ids', []);

            $signersByEmail = collect($signers)->keyBy(fn ($s) => strtolower((string) ($s['email'] ?? '')));
            foreach ($zohoActions as &$za) {
                $email = strtolower((string) ($za['recipient_email'] ?? ''));
                $m = $signersByEmail->get($email);
                if (is_array($m) && !empty($m['role'])) $za['cbc_role'] = (string) $m['role'];
            }
            unset($za);

            $perDocCoords = $this->mapClientCoordsToZohoDocIds((array) ($data['document_settings'] ?? []), [$c->id], $zohoDocumentIds);
            $submitResp = $this->zoho->submitWithFields($zohoRequestId, $zohoActions, $zohoDocumentIds, $perDocCoords);
            $submitted  = isset($submitResp['requests']);

            $finalStatus = 'inprogress';
            if ($submitted) {
                try { sleep(1); $after = $this->zoho->getRequest($zohoRequestId); $finalStatus = strtolower((string) data_get($after, 'requests.request_status', 'inprogress')); }
                catch (\Throwable $e) { $finalStatus = 'inprogress'; }
            }

            $sigReq = new ClmSignatureRequest();
            $sigReq->client_id         = $user->client_id;
            $sigReq->branch_id         = $user->branch_id ?? null;
            $sigReq->document_type     = 'ctc';
            $sigReq->trade_doc_id      = $c->id;
            $sigReq->trade_doc_ids     = [$c->id];
            $sigReq->document_names    = [$requestName];
            $sigReq->zoho_document_ids = array_values(array_filter(array_map(fn ($d) => $d['document_id'] ?? null, $zohoDocumentIds)));
            $sigReq->model_name        = 'CtcContract';
            $sigReq->party_id          = $c->id;
            $sigReq->zoho_request_id   = $zohoRequestId;
            $sigReq->request_name      = $requestName;
            $sigReq->status            = $finalStatus;
            $sigReq->signers           = $signers;
            $sigReq->expiry_date       = now()->addDays($expiryDays);
            $sigReq->metadata          = [
                'document_type'     => 'ctc',
                'ctc_contract_id'   => $c->id,
                'ctc_code'          => $c->code,
                'document_settings' => $data['document_settings'] ?? null,
                'request_uuid'      => $requestUuid,
                'sent_at'           => now()->toIso8601String(),
            ];
            $sigReq->created_by = Auth::id();
            $sigReq->save();

            // Advance the contract to Stage 3 with the signing tracker.
            $recipients = collect($signers)->map(fn ($s) => [
                'name' => $s['name'], 'email' => $s['email'], 'role' => $s['role'],
                'contact' => $s['name'], 'signed' => false, 'signed_at' => null,
            ])->all();
            // A resend after a decline carries the edited draft — persist it so
            // the contract body, preview and version snapshot all reflect it.
            if (array_key_exists('content_override', $data) && $data['content_override'] !== null) {
                $c->content = (string) $data['content_override'];
            }
            $c->signing_recipients   = $recipients;
            $c->days_to_sign         = $expiryDays;
            $c->stage                = 3;
            $c->status               = 'inprogress';
            $c->zoho_request_id      = $zohoRequestId;
            $c->signature_request_id = $sigReq->id;
            $versions = array_values($c->versions ?? []);
            $versions[] = [
                'v' => count($versions) + 1,
                'label' => 'Agreement sent to counterparty for signature & negotiation (Zoho Sign)',
                'status' => 'Sent for Signing', 'date' => now()->format('d M Y H:i'),
                'by' => $user->name ?? '', 'content' => $c->content,
            ];
            $c->versions = $versions;
            $c->save();

            $message = $finalStatus === 'inprogress' ? 'Agreement sent for signature via Zoho Sign.' : 'Agreement created in Zoho but submission did not flip to inprogress.';
            if ($this->zoho->isTestingMode()) $message .= ' (Sandbox mode — signer emails are only delivered to Zoho Sign users on this org.)';

            return response()->json(['status' => true, 'message' => $message, 'data' => [
                'signature_request_id' => $sigReq->id,
                'zoho_request_id'      => $zohoRequestId,
                'status'               => $finalStatus,
                'signers'              => $signers,
                'expiry_date'          => $sigReq->expiry_date,
                'testing_mode'         => $this->zoho->isTestingMode(),
            ]]);
        } catch (\Throwable $e) {
            Log::error('CTC send failed', ['error' => $e->getMessage(), 'contract' => $data['contract_id'] ?? null]);
            return response()->json(['status' => false, 'message' => 'Failed to send for signature: ' . $e->getMessage()], 500);
        } finally {
            foreach ($tempPaths as $p) @unlink($p);
        }
    }

    /**
     * GET /clm/ctc-contracts/{id}/sync-signature
     * Pull the live Zoho status for a CTC's signature request and reflect it
     * onto the contract's signing_recipients (signed flags) + status. Returns
     * the contract in the same shape as CtcContractController::show.
     */
    public function ctcSignatureStatus(Request $request, int $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $c = CtcContract::where('client_id', $user->client_id)->findOrFail($id);
        if ($c->zoho_request_id) {
            try {
                $details   = $this->zoho->getRequest($c->zoho_request_id);
                $reqStatus = strtolower((string) data_get($details, 'requests.request_status', 'inprogress'));
                // Zoho doesn't document the decline-reason key consistently —
                // it has surfaced as reason / reject_reason / decline_reason /
                // recipient_comment depending on org/version. Pull the first
                // non-empty from a broad candidate list on the action.
                $pickReason = function (array $a): string {
                    foreach (['reason', 'reject_reason', 'rejection_reason', 'decline_reason', 'declined_reason', 'recipient_comment', 'comments', 'comment', 'action_comment'] as $k) {
                        if (!empty($a[$k])) return (string) $a[$k];
                    }
                    return '';
                };
                $reqLevelReason = '';
                foreach (['reason', 'reject_reason', 'declined_reason', 'decline_reason'] as $k) {
                    $rv = data_get($details, "requests.$k");
                    if (!empty($rv)) { $reqLevelReason = (string) $rv; break; }
                }
                $byEmail = [];
                foreach (data_get($details, 'requests.actions', []) as $a) {
                    $email = strtolower((string) ($a['recipient_email'] ?? ''));
                    $byEmail[$email] = ['status' => strtolower((string) ($a['action_status'] ?? '')), 'reason' => $pickReason((array) $a), 'raw' => $a];
                }
                $recipients = array_values($c->signing_recipients ?? []);
                $stamp = now()->format('d M Y H:i');
                $declinedReason = null; $declinedBy = null;
                foreach ($recipients as &$r) {
                    $a  = $byEmail[strtolower((string) ($r['email'] ?? ''))] ?? ['status' => '', 'reason' => '', 'raw' => []];
                    $st = $a['status'];
                    if (in_array($st, ['signed', 'completed', 'approved']) && empty($r['signed'])) { $r['signed'] = true; $r['signed_at'] = $stamp; $r['declined'] = false; }
                    if (in_array($st, ['declined', 'rejected', 'recalled'])) {
                        // Log the raw declined action once so the exact reason key
                        // can be confirmed if it ever lands somewhere unexpected.
                        Log::info('CTC signer declined', ['contract' => $c->id, 'email' => $r['email'] ?? null, 'action' => $a['raw']]);
                        $reason = $a['reason'] ?: $reqLevelReason ?: ($r['decline_reason'] ?? '');
                        $r['declined'] = true; $r['signed'] = false;
                        $r['decline_reason'] = $reason;
                        $declinedReason = $reason; $declinedBy = $r['name'] ?? $r['email'] ?? null;
                    }
                }
                unset($r);
                $isDeclined = $declinedBy !== null || in_array($reqStatus, ['declined', 'rejected', 'recalled']);
                $allSigned  = !$isDeclined && count($recipients) > 0 && collect($recipients)->every(fn ($r) => !empty($r['signed']));

                if ($isDeclined && empty($c->signature_declined_at)) {
                    // First time we see the decline → stamp it + log a version event.
                    $c->signature_declined_at = now();
                    $this->ctcPushVersion($c, 'Declined by ' . ($declinedBy ?: 'a signer') . ($declinedReason ? ' — ' . $declinedReason : ''), 'Declined', $declinedBy ?: 'Signer');
                } elseif (!$isDeclined) {
                    $c->signature_declined_at = null;
                }
                if ($reqStatus === 'completed' || $allSigned) {
                    foreach ($recipients as &$r2) { if (empty($r2['signed'])) { $r2['signed'] = true; $r2['signed_at'] = $stamp; } }
                    unset($r2);
                    if (!$c->cp_signed_date) $c->cp_signed_date = now();
                    // Pull the fully-signed PDF + certificate down from Zoho onto
                    // the linked signature request so it can be shown/downloaded.
                    if ($c->signature_request_id) {
                        $sr = ClmSignatureRequest::find($c->signature_request_id);
                        if ($sr) {
                            if ($sr->status !== 'completed') { $sr->status = 'completed'; if (!$sr->completed_at) $sr->completed_at = now(); $sr->save(); }
                            if (empty($sr->fresh()->signed_document_paths)) {
                                try { $this->fetchSignedArtifacts($sr, $details); } catch (\Throwable $e) { Log::warning('CTC signed artifact fetch failed: ' . $e->getMessage()); }
                            }
                        }
                    }
                }
                $c->signing_recipients = $recipients;
                $c->save();
            } catch (\Throwable $e) {
                Log::warning('CTC signature sync failed: ' . $e->getMessage());
            }
        }
        $c = $c->fresh();
        $branch = $c->branch_id ? Branch::find($c->branch_id) : null;
        $c->org_signature_url = $branch?->signature_url;
        $c->signed_document_url = $this->ctcSignedDocumentUrl($c);
        return response()->json(['status' => true, 'data' => $c]);
    }

    /** Public URL of the fully-signed PDF for a CTC (from its signature request), or null. */
    private function ctcSignedDocumentUrl(CtcContract $c): ?string
    {
        if (!$c->signature_request_id) return null;
        $sr = ClmSignatureRequest::find($c->signature_request_id);
        $paths = is_array($sr?->signed_document_paths) ? $sr->signed_document_paths : [];
        $first = $paths[0] ?? null;
        if (!is_array($first)) return null;
        return $first['file_url'] ?? $first['url'] ?? (isset($first['path']) ? file_url($first['path']) : null);
    }

    /**
     * POST /clm/ctc-contracts/{id}/remind-signing
     * Nudge the counterparty signers to sign — Zoho Sign re-emails everyone
     * who hasn't acted yet on the contract's active signature request.
     */
    public function ctcRemindSigning(Request $request, int $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $c = CtcContract::where('client_id', $user->client_id)->findOrFail($id);
        if (!$c->zoho_request_id) return response()->json(['status' => false, 'message' => 'No active signature request to remind.'], 422);
        if (!$this->zoho->isConfigured()) return response()->json(['status' => false, 'message' => 'Zoho Sign is not configured.'], 503);
        try {
            $this->zoho->remind($c->zoho_request_id);
            if ($c->signature_request_id) {
                $sr = ClmSignatureRequest::find($c->signature_request_id);
                if ($sr) {
                    $sr->reminder_count        = (int) ($sr->reminder_count ?? 0) + 1;
                    $sr->last_reminder_sent_at = now();
                    $sr->save();
                }
            }
            return response()->json(['status' => true, 'message' => 'Reminder sent to the counterparty signers via Zoho Sign.']);
        } catch (\Throwable $e) {
            Log::error('CTC signing reminder failed', ['error' => $e->getMessage(), 'contract' => $id]);
            return response()->json(['status' => false, 'message' => 'Could not send reminder: ' . $e->getMessage()], 500);
        }
    }

    /** Render a CTC contract body to a signature-ready PDF (page-shell + org sig). */
    private function renderCtcPdf(CtcContract $c, array $signers, ?array $headerOverride, ?array $footerOverride, ?string $contentOverride, string $requestUuid)
    {
        $sourceHtml = $contentOverride !== null ? $contentOverride : (string) $c->content;
        $sig = $this->ctcOrgSignatureDataUri($c);
        $sigHtml = $sig ? '<img src="' . $sig . '" alt="Authorised Signatory" style="max-height:80px;max-width:210px;object-fit:contain;" />' : '';
        $processedHtml = preg_replace('/\{\{\s*signature\s*\}\}/i', $sigHtml, $sourceHtml);

        $client = Client::find($c->client_id);
        $headerConfig = is_array($headerOverride) ? $headerOverride : (is_array($c->header_config) ? $c->header_config : []);
        $footerConfig = is_array($footerOverride) ? $footerOverride : (is_array($c->footer_config) ? $c->footer_config : []);
        $headerLogoBase64 = $this->resolveLogoBase64(
            $headerConfig['logo_path'] ?? null,
            $this->pathFromStorageUrl($headerConfig['logo_url'] ?? null),
            $client?->logo,
        );

        return Pdf::loadView('pdf.clm-signature-document', [
            'document'         => $c,
            'party'            => null,
            'modelName'        => '',
            'processedHtml'    => $processedHtml,
            'generatedDate'    => now()->format('d/m/Y'),
            'requestId'        => substr($requestUuid, 0, 8),
            'signers'          => $signers,
            'client'           => $client,
            'headerConfig'     => $headerConfig,
            'footerConfig'     => $footerConfig,
            'headerLogoBase64' => $headerLogoBase64,
        ])->setPaper('a4')->setOption('isPhpEnabled', true);
    }

    /** Append an audit/version entry to a CTC contract (mirrors CtcContractController). */
    private function ctcPushVersion(CtcContract $c, string $label, string $status, string $by): void
    {
        $versions = array_values($c->versions ?? []);
        $versions[] = [
            'v' => count($versions) + 1, 'label' => $label, 'status' => $status,
            'date' => now()->format('d M Y H:i'), 'by' => $by, 'content' => $c->content,
        ];
        $c->versions = $versions;
    }

    /** Branch (receiving-party) signature + stamp image as a data URI. */
    private function ctcOrgSignatureDataUri(CtcContract $c): ?string
    {
        $branch = $c->branch_id ? Branch::find($c->branch_id) : null;
        $path = $branch?->signature_path;
        if (!$path) return null;
        if (preg_match('#/storage/(.+)$#', (string) $path, $m)) $path = $m[1];
        try {
            if (!Storage::disk('public')->exists($path)) return null;
            $data = base64_encode(Storage::disk('public')->get($path));
            $ext  = strtolower(pathinfo($path, PATHINFO_EXTENSION) ?: 'png');
            $mime = in_array($ext, ['jpg', 'jpeg']) ? 'image/jpeg' : ($ext === 'webp' ? 'image/webp' : 'image/png');
            return "data:$mime;base64,$data";
        } catch (\Throwable $e) { return null; }
    }

    /**
     * Stage 5 (Quotation vs PI) → Send for Signature.
     *
     * Renders the Quotation / Proforma Invoice PDF (the same with-signature
     * artifact used by preview + email, via SalesPdfController) and ships it
     * to Zoho Sign for the buyer (customer) plus, when present/selected, the
     * consignee. Mirrors agreementSend() — only the document source differs
     * (a rendered sales PDF instead of a CLM library row). The persisted row
     * uses document_type = quotation|proforma_invoice; status / remind /
     * recall / signed-file streaming all reuse the generic methods below.
     */
    public function salesDocSend(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);
        if (!$user->client_id) return response()->json(['status' => false, 'message' => 'No tenant context'], 403);

        if (!$this->zoho->isConfigured()) {
            return response()->json(['status' => false, 'message' => 'Zoho Sign is not configured. Contact your administrator.'], 503);
        }

        $data = $request->validate([
            'doc_kind'          => 'required|string|in:quotation,proforma_invoice',
            'doc_id'            => 'required|integer',
            // Lead is OPTIONAL — a quotation/PI created directly (no
            // opportunity, e.g. a "Without Shipment" PI) has no lead. Signers
            // are resolved from the document record itself, so a lead isn't
            // needed to send for signature.
            'lead_id'           => 'nullable|integer|exists:leads,id',
            'signers'           => 'nullable|array|max:5',
            'signers.*.role'    => 'nullable|string|max:32',
            'signers.*.email'   => 'required_with:signers|email',
            'signers.*.name'    => 'nullable|string|max:255',
            'signers.*.order'   => 'nullable|integer|min:1',
            // Per-signature placement keyed by doc_id → { role → {x,y,page,width,height} }.
            'document_settings' => 'nullable|array',
            'expiry_days'       => 'nullable|integer|min:1|max:180',
            'is_sequential'     => 'nullable|boolean',
            'notes'             => 'nullable|string|max:1000',
        ]);

        $docKind = $data['doc_kind'];
        $docId   = (int) $data['doc_id'];
        // Lead may be omitted (direct PI/quotation with no opportunity); when
        // supplied it's tenant-scoped. Falls back to the document's own opp_id
        // below once the record is loaded.
        $lead    = !empty($data['lead_id'])
            ? Lead::where('client_id', $user->client_id)->findOrFail($data['lead_id'])
            : null;

        // 1. Render the sales PDF to a temp file (reuses SalesPdfController so
        //    the signed source byte-matches what preview/email produce).
        try {
            $rendered = app(SalesPdfController::class)->renderSalesDocPdfToTemp($docKind, $docId, $user, true);
        } catch (\Illuminate\Database\Eloquent\ModelNotFoundException $e) {
            return response()->json(['status' => false, 'message' => 'Document not found.'], 404);
        }
        $tempPath = $rendered['path'];
        $record   = $rendered['record'];

        // When no lead was supplied, adopt the document's own opportunity (if
        // it has one) so the signature row still records the linkage.
        if (!$lead && !empty($record->opp_id)) {
            $lead = Lead::where('client_id', $user->client_id)->find($record->opp_id);
        }
        // Defence-in-depth: when a lead IS in context, the doc must belong to
        // it. A document with no opportunity simply has no lead linkage.
        if ($lead && (int) ($record->opp_id ?? 0) !== (int) $lead->id) {
            @unlink($tempPath);
            return response()->json(['status' => false, 'message' => 'This document does not belong to the supplied opportunity.'], 422);
        }

        try {
            // 2. Resolve signers — buyer (customer) + optional consignee.
            $signers = $this->resolveSalesDocSigners($record, $data['signers'] ?? null);
            if (empty($signers)) {
                @unlink($tempPath);
                return response()->json([
                    'status'  => false,
                    'message' => 'No signer could be resolved — the customer (or a selected signer) has no email on this document.',
                ], 422);
            }

            // Primary party owns the signature_requests row (scoping). Prefer
            // the customer; fall back to consignee if there's no customer.
            $primaryIsCustomer = (int) ($record->customer_id ?? 0) > 0;
            $primaryId         = $primaryIsCustomer ? (int) $record->customer_id : (int) ($record->consignee_id ?? 0);

            $expiryDays  = (int) ($data['expiry_days'] ?? 30);
            $shortLabel  = $docKind === 'quotation' ? 'QT' : 'PI';
            $docName     = $record->code ? "{$shortLabel} {$record->code}" : $rendered['filename'];
            $requestName = $record->code ?: $rendered['filename'];

            // 3. Build Zoho actions.
            $actions = [];
            foreach ($signers as $i => $signer) {
                $actions[] = [
                    'recipient_email'  => $signer['email'],
                    'recipient_name'   => $signer['name'],
                    'action_type'      => 'SIGN',
                    'signing_order'    => $signer['order'] ?? ($i + 1),
                    'verify_recipient' => false,
                ];
            }

            $requestBody = [
                'requests' => [
                    'request_name'    => $requestName,
                    'is_sequential'   => (bool) ($data['is_sequential'] ?? false),
                    'expiration_days' => $expiryDays,
                    'notes'           => (string) ($data['notes'] ?? 'Please review and sign this document.'),
                    'actions'         => $actions,
                ],
            ];

            // 4. Create Zoho request (multipart — JSON + the single PDF).
            $createResp    = $this->zoho->createRequestMultipart([$tempPath], [$rendered['filename']], $requestBody);
            $zohoRequestId = data_get($createResp, 'requests.request_id');
            if (!$zohoRequestId) {
                throw new RuntimeException('Zoho create-request did not return a request_id: ' . json_encode($createResp));
            }

            // 5. Fetch the created request, tag actions with cbc_role, submit
            //    with the per-signer signature-field coordinates.
            $details         = $this->zoho->getRequest($zohoRequestId);
            $zohoActions     = data_get($details, 'requests.actions',      []);
            $zohoDocumentIds = data_get($details, 'requests.document_ids', []);

            $signersByEmail = collect($signers)->keyBy(fn($s) => strtolower((string) ($s['email'] ?? '')));
            foreach ($zohoActions as &$zohoAction) {
                $email = strtolower((string) ($zohoAction['recipient_email'] ?? ''));
                $match = $signersByEmail->get($email);
                if (is_array($match) && !empty($match['role'])) {
                    $zohoAction['cbc_role'] = (string) $match['role'];
                }
            }
            unset($zohoAction);

            // document_settings arrives keyed by doc_id → { role → coords };
            // mapClientCoordsToZohoDocIds re-keys it onto the Zoho doc id.
            $perDocCoords = $this->mapClientCoordsToZohoDocIds(
                (array) ($data['document_settings'] ?? []),
                [$docId],
                $zohoDocumentIds
            );

            $submitResp = $this->zoho->submitWithFields($zohoRequestId, $zohoActions, $zohoDocumentIds, $perDocCoords);
            $submitted  = isset($submitResp['requests']);

            // 6. Read back final status.
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

            // 7. Persist. trade_doc_id/_ids reuse for the quotation/PI id —
            //    the polymorphic discriminator is document_type.
            $sigReq = new ClmSignatureRequest();
            $sigReq->client_id         = $user->client_id;
            $sigReq->branch_id         = $user->branch_id ?? null;
            $sigReq->document_type     = $docKind === 'quotation'
                ? ClmSignatureRequest::DOC_QUOTATION
                : ClmSignatureRequest::DOC_PROFORMA_INVOICE;
            $sigReq->lead_id           = $lead?->id;
            $sigReq->trade_doc_id      = $docId;
            $sigReq->trade_doc_ids     = [$docId];
            $sigReq->document_names    = [$docName];
            $sigReq->zoho_document_ids = array_values(array_filter(array_map(fn($d) => $d['document_id'] ?? null, $zohoDocumentIds)));
            $sigReq->model_name        = $primaryIsCustomer ? 'Customer' : 'Consignee';
            $sigReq->party_id          = $primaryId;
            $sigReq->zoho_request_id   = $zohoRequestId;
            $sigReq->request_name      = $requestName;
            $sigReq->status            = $finalStatus;
            $sigReq->signers           = $signers;
            $sigReq->expiry_date       = now()->addDays($expiryDays);
            $sigReq->metadata          = [
                'sent_at'           => now()->toIso8601String(),
                'document_type'     => $docKind,
                'doc_id'            => $docId,
                'doc_code'          => $record->code,
                'lead_id'           => $lead?->id,
                'document_settings' => $data['document_settings'] ?? null,
            ];
            $sigReq->created_by = Auth::id();
            $sigReq->save();

            $label   = $docKind === 'quotation' ? 'Quotation' : 'Proforma Invoice';

            // 8. Also email the rendered PDF to the signer (customer contact)
            //    as an attachment, alongside Zoho's signing notification. The
            //    email is best-effort: a mail hiccup must NOT fail an already-
            //    created signature request, so failures are logged, not thrown.
            //    Reuses $tempPath (cleaned up in the finally below) and the
            //    SalesPdfController email builder so the body/branding match the
            //    manual "Email document" flow byte-for-byte.
            $pdfEmailed   = false;
            $signerEmail  = (string) ($signers[0]['email'] ?? '');
            if ($signerEmail !== '') {
                try {
                    $emailKind     = $docKind === 'quotation' ? 'Quotation' : 'Proforma Invoice';
                    $safeCode      = preg_replace('/[^A-Za-z0-9_-]/', '_', (string) ($record->code ?: ('id-' . $record->id)));
                    $emailFilename = "{$shortLabel}-{$safeCode}_signed.pdf";
                    app(SalesPdfController::class)->buildAndSendSalesDocEmail(
                        $record, $emailKind, $shortLabel, $signerEmail, $tempPath, $emailFilename
                    );
                    $pdfEmailed = true;
                } catch (\Throwable $e) {
                    Log::warning('Sales-doc signature send: PDF email to signer failed', [
                        'doc_kind' => $docKind,
                        'doc_id'   => $docId,
                        'to'       => $signerEmail,
                        'error'    => $e->getMessage(),
                    ]);
                }
            }

            $message = $finalStatus === 'inprogress'
                ? "{$label} sent for signature successfully."
                : "{$label} created in Zoho but submission did not flip to inprogress.";
            if ($pdfEmailed) {
                $message .= " The {$label} PDF was also emailed to {$signerEmail}.";
            }
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
                    'document_names'       => $sigReq->document_names,
                    'signers'              => $sigReq->signers,
                    'expiry_date'          => $sigReq->expiry_date,
                    'auto_submitted'       => $submitted,
                    'testing_mode'         => $this->zoho->isTestingMode(),
                    'pdf_emailed'          => $pdfEmailed,
                ],
            ]);
        } catch (\Throwable $e) {
            Log::error('CLM sales-doc send failed', [
                'error'   => $e->getMessage(),
                'trace'   => $e->getTraceAsString(),
                'request' => $request->all(),
            ]);
            return response()->json(['status' => false, 'message' => 'Failed to send document for signature: ' . $e->getMessage()], 500);
        } finally {
            @unlink($tempPath);
        }
    }

    /**
     * Build the signer list for a Quotation / PI send. Business rule:
     * ONLY the customer's primary contact person signs (no consignee).
     * The contact-person email/name come from the customer's primary
     * address (cp_email / cp_name); `customers.primary_email` mirrors the
     * primary contact's email, so it's the fallback. The $override is
     * intentionally ignored — the authoritative signer is always the
     * customer's primary contact.
     */
    private function resolveSalesDocSigners($record, ?array $override): array
    {
        $customer = $record->customer;
        if (!$customer) return [];

        $addr  = $customer->primaryAddress;
        $email = trim((string) ($addr->cp_email ?? '')) ?: trim((string) ($customer->primary_email ?? ''));
        if ($email === '') return [];

        $name = trim((string) ($addr->cp_name ?? '')) ?: ($customer->company_name ?: 'Customer');

        return [[
            'email' => $email,
            'name'  => $name,
            'order' => 1,
            'role'  => 'buyer',
        ]];
    }

    /**
     * Decode the agreement's `party` CSV against the lead's customer +
     * consignee and produce a signer list ready for Zoho. Returns
     *   [primaryPartyModel, 'Customer'|'Consignee', signersArray]
     *
     * Primary party is the buyer when present (customer), else consignee.
     * Both are added as signers when the CSV calls for them. Supplier-*
     * tokens are skipped — supplier signing belongs to procure-to-pay.
     */
    private function resolveAgreementSigners(ClmAgreementLibrary $agreement, Lead $lead, $user): array
    {
        $partyTokens = collect(explode(',', (string) $agreement->party))
            ->map(fn($s) => trim($s))
            ->filter()
            ->values();

        $wantsBuyer     = $partyTokens->contains(fn($t) => strcasecmp($t, 'Buyer') === 0);
        $wantsConsignee = $partyTokens->contains(fn($t) => strcasecmp($t, 'Consignee') === 0);

        $customer  = $lead->customer_id  ? Customer::query()->forUser($user)->find($lead->customer_id)   : null;
        $consignee = $lead->consignee_id ? Consignee::query()->forUser($user)->find($lead->consignee_id) : null;

        $signers = [];
        $order   = 1;
        if ($wantsBuyer && $customer && $customer->primary_email) {
            $signers[] = [
                'email' => $customer->primary_email,
                'name'  => $customer->company_name ?: 'Buyer',
                'order' => $order++,
                // Role tag — used downstream to look up the per-signer
                // signature box coords supplied by the SPA when the
                // user drags each role's overlay independently.
                'role'  => 'buyer',
            ];
        }
        if ($wantsConsignee && $consignee && $consignee->primary_email) {
            $signers[] = [
                'email' => $consignee->primary_email,
                'name'  => $consignee->company_name ?: 'Consignee',
                'order' => $order++,
                'role'  => 'consignee',
            ];
        }

        // All resolvable parties on the lead, keyed by model name, so the
        // agreement render path can substitute placeholders for every
        // applicable namespace (`{{customer.*}}` AND `{{consignee.*}}`
        // on a Buyer+Consignee agreement, not just the primary's tokens).
        // null entries are skipped so callers can rely on the keys being
        // present iff the lead has that side mapped.
        $allParties = array_filter([
            'Customer'  => $customer,
            'Consignee' => $consignee,
        ]);

        // Primary party = whichever side will own the signature_requests
        // row (for tenant + visibility scoping). Prefer customer.
        if ($customer)      return [$customer,  'Customer',  $signers, $allParties];
        if ($consignee)     return [$consignee, 'Consignee', $signers, $allParties];
        return [null, 'Customer', $signers, $allParties];
    }


    private function renderAgreementPdf(
        ClmAgreementLibrary $agreement,
        Model $party,
        string $modelName,
        string $requestUuid,
        ?array $signers = null,
        ?array $headerOverride = null,
        ?array $footerOverride = null,
        ?string $contentOverride = null,
        array $allParties = [],
    ) {
        // Body HTML: per-send override beats the saved row's content.
        // The override path lets the workplace Send-for-Signature flow
        // tweak agreement copy without mutating the master.
        $sourceHtml    = $contentOverride !== null ? $contentOverride : (string) $agreement->content;
        // $allParties carries every party the lead has mapped (Customer
        // + Consignee for a Buyer+Consignee agreement). Without it,
        // replacePlaceholders only substitutes the primary's tokens
        // and `{{consignee.name}}` stays as literal text in the PDF.
        $processedHtml = $this->replacePlaceholders($sourceHtml, $party, $modelName, $allParties);
        $client        = Client::find($agreement->client_id);

        // Read the row's saved page-shell config (Stage 2 wizard) so the
        // PDF matches what the user composed in the editor. Missing on
        // pre-migration rows → empty array; blade falls back to a
        // minimal client-name header so older agreements still render.
        // Per-send overrides are LAYERED over the saved config (rather
        // than replacing it wholesale) so the user can tweak one field
        // — e.g. just the footer text — without having to repopulate
        // every other column the editor would have shown.
        $savedHeader = is_array($agreement->header_config) ? $agreement->header_config : [];
        $savedFooter = is_array($agreement->footer_config) ? $agreement->footer_config : [];
        $headerConfig = is_array($headerOverride) ? array_replace($savedHeader, $headerOverride) : $savedHeader;
        $footerConfig = is_array($footerOverride) ? array_replace($savedFooter, $footerOverride) : $savedFooter;

        $headerLogoBase64 = $this->resolveLogoBase64(
            $headerConfig['logo_path'] ?? null,
            $this->pathFromStorageUrl($headerConfig['logo_url'] ?? null),
            $client?->logo,
        );

        // Build a stand-in object that the trade-doc blade can read with
        // its existing `$document->title ?? $document->name ?? 'Document'`
        // contract. We pass the agreement directly — title is present.
        // Enable inline PHP execution so the blade's
        // <script type="text/php"> page-number stamp can call
        // $pdf->page_text(). The global config/dompdf.php has
        // `enable_php = false` for safety, so we opt-in per render.
        // Without this, {PAGE_NUM}/{PAGE_COUNT} never get substituted
        // and the footer page number is silently dropped.
        return Pdf::loadView('pdf.clm-signature-document', [
            'document'         => $agreement,
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
        ])
            ->setPaper('a4')
            ->setOption('isPhpEnabled', true);
    }

    /* ─────────────────────── LIST / SHOW ─────────────────────── */

    public function index(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);

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
            if (
                $consignee
                && $consignee->same_as_customer
                && $consignee->customer_id
                && (!$user->client_id || (int) ($consignee->client_id ?? 0) === (int) $user->client_id)
            ) {
                $filterPartyId   = (int) $consignee->customer_id;
                $filterModelName = 'Customer';
            }
        }

        // Honour the BranchSwitcher (see CustomerController::index) so a
        // main-branch user viewing "as" a specific branch only sees that
        // branch's signature requests.
        $q = ClmSignatureRequest::query()
            ->forUser($user, $request->integer('branch_id') ?: null)
            ->latest();

        if ($filterPartyId)   $q->where('party_id', $filterPartyId);
        if ($filterModelName) $q->where('model_name', $filterModelName);
        // Doc-type scoping — the trade-doc and agreement Send flows share
        // this index but ALWAYS want to see rows of their own doc type.
        // Without the filter, the LeadAgreementSendModal poller would
        // pick up trade-doc requests for the same party and try to
        // project them onto agreement rows that happen to share numeric
        // IDs. `lead_id` is also accepted so the agreement poller can
        // scope strictly to the opportunity it's watching.
        if ($request->filled('document_type')) {
            $q->where('document_type', (string) $request->document_type);
        }
        if ($request->filled('lead_id')) {
            $q->where('lead_id', (int) $request->lead_id);
        }
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
        //
        // Recovery path — also retry the artifact fetch for rows already
        // marked `completed` locally but missing `signed_document_paths`
        // on disk. That happens when the initial fetchSignedArtifacts
        // succeeded for the certificate (separate try/catch) but Zoho's
        // per-document PDF download failed transiently (network blip,
        // Zoho's signed PDF still processing in their pipeline, etc.).
        // Without this, the user is stuck seeing the Certificate icon
        // enabled and the View / Download icons disabled forever.
        if ($request->boolean('sync') && $this->zoho->isConfigured()) {
            $changed = false;
            foreach ($rows as $row) {
                if (!$row->zoho_request_id) continue;

                $isInProgress      = $row->status === 'inprogress';
                $isCompletedNoFile = $row->status === 'completed'
                    && empty($row->signed_document_paths);
                if (!$isInProgress && !$isCompletedNoFile) continue;

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
                    }
                    // Retry artifact fetch on EVERY completed-with-no-file
                    // pass too, not just on the status transition. Cheap
                    // when files already exist (fetchSignedArtifacts
                    // overwrites on success). The user's "View/Download
                    // stuck disabled" stops as soon as the PDF download
                    // succeeds.
                    if (
                        $newStatus === 'completed'
                        && empty($row->fresh()->signed_document_paths)
                    ) {
                        $this->fetchSignedArtifacts($row, $details);
                        $changed = true;
                    }
                } catch (\Throwable $e) {
                    Log::warning("Zoho sync skipped for sig request {$row->id}: " . $e->getMessage());
                }
            }
            if ($changed) {
                $rows = $q->limit(200)->get();
            }
        }

        // Resolve every stored file path into a public URL the SPA can
        // open directly. We can't ship raw `uploads/…` paths in the JSON
        // because on the deployed environment the files live in Azure
        // (cbc-saas blob container) while the SPA is served from a
        // different origin — a relative `/uploads/…` would 404 against
        // the API host. Using file_url() (app/helpers.php) mirrors the
        // pattern every other controller already uses (CustomerOwner,
        // ConsigneeDocument, EmployeeDocument, …) so the frontend sees
        // the same shape of URL on every endpoint.
        $rows->transform(function (ClmSignatureRequest $row) {
            // Per-document URLs. Saved-paths shape is:
            //   [ { zoho_document_id, document_name, path, url, file_url, size? }, … ]
            // Older rows may carry only `path`. Resolve each into a fresh
            // `file_url` so the frontend never has to know about disks.
            $multi = is_array($row->signed_document_paths) ? $row->signed_document_paths : [];
            $resolvedMulti = array_map(function ($entry) {
                if (!is_array($entry)) return $entry;
                $abs = $entry['url'] ?? $entry['file_url'] ?? null;
                $path = $entry['path'] ?? null;
                $resolved = (is_string($abs) && preg_match('#^https?://#i', $abs))
                    ? $abs
                    : file_url($path);
                $entry['url']      = $resolved;
                $entry['file_url'] = $resolved;
                return $entry;
            }, $multi);

            /* Disk-scan fallback. When status === 'completed' but
             * signed_document_paths is empty, the actual signed PDFs
             * frequently DO exist in the customer/consignee/vendor
             * signed_documents folder — fetchSignedArtifacts wrote them
             * successfully in a prior run but a later partial-fail or DB
             * blip left the column unset.
             *
             * Rather than fight Zoho for another download, just list the
             * folder and match by document-name slug (the same slug
             * fetchSignedArtifacts uses when naming the blob:
             * `signed_<slug>_<ts>_<i>.pdf`). Most-recent file per doc
             * wins, surfacing the latest send.
             *
             * Results are merged into $resolvedMulti at READ time only —
             * we don't persist them, so the next successful Zoho retry
             * (which writes a richer payload with zoho_document_id +
             * size) is still authoritative when it lands. */
            if (empty($resolvedMulti) && $row->status === 'completed') {
                $fromDisk = $this->adoptSignedDocsFromDisk($row);
                if (!empty($fromDisk)) $resolvedMulti = $fromDisk;
            }

            // Surface the resolved URLs alongside the path columns so the
            // frontend's polling loop (and any future consumer) can read
            // them directly without re-resolving against another origin.
            // Single-doc convenience pointer mirrors the multi array shape.
            $firstSignedFromDisk = $resolvedMulti[0]['file_url'] ?? null;
            $row->setAttribute('signed_document_url',  file_url($row->signed_document_path) ?: $firstSignedFromDisk);
            $row->setAttribute('certificate_url',      file_url($row->certificate_path));
            $row->setAttribute('signed_document_paths', $resolvedMulti);
            $row->setAttribute('file_url', file_url($row->signed_document_path) ?: $firstSignedFromDisk ?: file_url($row->certificate_path));
            return $row;
        });

        return response()->json(['status' => true, 'data' => $rows, 'count' => $rows->count()]);
    }

    /**
     * Sync status from Zoho. When the request has just completed, this is
     * also the point at which we pull the signed PDFs + completion
     * certificate down into local storage.
     */
    public function show(Request $request, $id)
    {
        $user = $request->user();
        if (!$user) abort(401);
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
        $user = $request->user();
        if (!$user) abort(401);
        $row  = ClmSignatureRequest::query()->forUser($user)->findOrFail($id);

        try {
            $live   = $this->zoho->getRequest($row->zoho_request_id);
            $state  = strtolower((string) data_get($live, 'requests.request_status', $row->status));
            if ($state !== $row->status) {
                $row->status = $state;
                $row->save();
            }
            if ($state !== 'inprogress') {
                return response()->json(['status' => false, 'message' => "Reminder cannot be sent. Current status is '{$state}'."], 400);
            }

            $resp = $this->zoho->remind($row->zoho_request_id);
            $row->last_reminder_sent_at = now();
            $row->reminder_count        = (int) $row->reminder_count + 1;
            $row->save();

            // Echo the updated counter + timestamp so the frontend can
            // bump the on-button badge without a full refetch. Customer /
            // consignee / vendor / agreement flows all read these.
            return response()->json([
                'status'  => true,
                'message' => 'Reminder sent',
                'data'    => [
                    'zoho'                  => $resp,
                    'reminder_count'        => (int) $row->reminder_count,
                    'last_reminder_sent_at' => optional($row->last_reminder_sent_at)->toIso8601String(),
                ],
            ]);
        } catch (\Throwable $e) {
            return response()->json(['status' => false, 'message' => 'Failed to send reminder: ' . $e->getMessage()], 500);
        }
    }

    public function recall(Request $request, $id)
    {
        $user = $request->user();
        if (!$user) abort(401);
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
        $user = $request->user();
        if (!$user) abort(401);
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
        $user = $request->user();
        if (!$user) abort(401);
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

        // Opt-in to inline PHP so the blade's footer page-number
        // <script type="text/php"> can stamp {PAGE_NUM}/{PAGE_COUNT}.
        // See the agreement render path for the same toggle + rationale.
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
        ])
            ->setPaper('a4')
            ->setOption('isPhpEnabled', true);
    }

    /**
     * Walk candidate storage paths in priority order and return the
     * first one that resolves to a file on the public disk, base64-
     * encoded for inline embedding in the PDF. Returns '' when none of
     * them resolve, so the blade renders a text-only header band.
     */
    private function resolveLogoBase64(?string ...$candidates): string
    {
        $disk = \Illuminate\Support\Facades\Storage::disk('public');
        foreach ($candidates as $path) {
            if (!$path) continue;
            try {
                if (!$disk->exists($path)) continue;

                // Cache the flattened + encoded logo keyed by path + mtime so
                // the Send-for-Signature modal — which re-renders the preview
                // on every page-nav and inline edit — doesn't re-run the GD
                // flatten + base64 on every call. A logo re-upload changes
                // lastModified and busts the entry.
                $stamp    = (string) ($disk->lastModified($path) ?: 0);
                $cacheKey = 'clm_sig_logo_b64:' . md5($path . '|' . $stamp);

                return \Illuminate\Support\Facades\Cache::remember(
                    $cacheKey,
                    now()->addDay(),
                    function () use ($disk, $path) {
                        $bytes = $disk->get($path);
                        // Flatten any alpha channel onto white + downscale
                        // before embedding. DomPDF renders transparent PNGs by
                        // splitting an alpha mask pixel-by-pixel in pure PHP —
                        // on a large logo that loop runs width×height times and
                        // can blow past PHP's max_execution_time (the same
                        // slowdown SalesPdfController::flattenImageForPdf fixes
                        // for the Quotation/PI render). The blade always emits
                        // `data:image/png;base64,…`, so PNG output is correct.
                        $flat = $this->flattenImageForPdf($bytes);
                        return base64_encode($flat ?? $bytes);
                    }
                );
            } catch (\Throwable $e) {
                // try the next candidate
            }
        }
        return '';
    }

    /**
     * Composite an image onto a solid white background (dropping any alpha
     * channel) and downscale it to a sane max width, returning PNG bytes — or
     * null if GD isn't available or the bytes aren't a decodable image.
     *
     * Mirrors SalesPdfController::flattenImageForPdf. Handing DomPDF an opaque
     * (no-alpha) PNG avoids its pure-PHP transparent-PNG pixel walk, which is
     * the main cause of slow / timing-out signature-document renders.
     */
    private function flattenImageForPdf(string $bytes, int $maxWidth = 800): ?string
    {
        if (!function_exists('imagecreatefromstring')) return null;

        $src = @imagecreatefromstring($bytes);
        if ($src === false) return null;

        try {
            $sw = max(1, imagesx($src));
            $sh = max(1, imagesy($src));
            $scale = $sw > $maxWidth ? $maxWidth / $sw : 1.0;
            $dw = max(1, (int) round($sw * $scale));
            $dh = max(1, (int) round($sh * $scale));

            $canvas = imagecreatetruecolor($dw, $dh);
            imagefilledrectangle($canvas, 0, 0, $dw, $dh, imagecolorallocate($canvas, 255, 255, 255));
            imagealphablending($canvas, true);
            if ($scale < 1.0) {
                imagecopyresampled($canvas, $src, 0, 0, 0, 0, $dw, $dh, $sw, $sh);
            } else {
                imagecopy($canvas, $src, 0, 0, 0, 0, $sw, $sh);
            }
            imagesavealpha($canvas, false);

            ob_start();
            imagepng($canvas, null, 6);
            $out = ob_get_clean();
            imagedestroy($canvas);

            return ($out !== false && $out !== '') ? $out : null;
        } finally {
            imagedestroy($src);
        }
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
    private function replacePlaceholders(string $html, Model $party, string $modelName, array $extraParties = []): string
    {
        if ($html === '') return '<p></p>';

        // Substitute the primary party first, then iterate every extra
        // party from $extraParties so a Buyer+Consignee agreement gets
        // BOTH `{{customer.*}}` AND `{{consignee.*}}` resolved. The
        // `extraParties` map is keyed by model name (Customer / Consignee
        // / Vendor) so we can skip the primary when it appears in the
        // map too.
        $html = $this->replacePartyNamespaceTokens($html, $party, $modelName);
        foreach ($extraParties as $extraModelName => $extraParty) {
            if (!$extraParty) continue;
            if ($extraModelName === $modelName) continue; // already done
            $html = $this->replacePartyNamespaceTokens($html, $extraParty, $extraModelName);
        }

        // Signature placeholders — every party variant becomes a styled
        // sig-box. The unique invisible marker (rendered at 0.5pt in a
        // near-white colour) is picked up by the frontend PDF.js detector
        // so it can use the placeholder's rendered position as the default
        // for the draggable signature overlay. Zoho's real signature
        // widget is positioned by the (x, y, page) coords in the submit
        // payload — the box here is purely visual + detection scaffolding.
        //
        // `buyer` is an alias for `customer` so the agreement Stage-2
        // picker's `{{buyer.signature}}` resolves the same way as the
        // trade-doc `{{customer.signature}}`. Regex pass instead of
        // str_replace so `{{ buyer.signature }}` / case-variants also
        // resolve (matches the body-token tolerance above).
        $signatureAliases = [
            'customer'  => 'customer',
            'buyer'     => 'customer',
            'consignee' => 'consignee',
            'supplier'  => 'supplier',
        ];
        foreach ($signatureAliases as $alias => $canonical) {
            $token  = self::sigMarkerToken($canonical);
            $sigBox = '<div class="sig-box">'
                . '<span class="sig-marker">' . $token . '</span>'
                . '[ Signature ]'
                . '</div>';
            $pattern = '/\{\{\s*' . preg_quote($alias, '/') . '\s*\.\s*signature\s*\}\}/iu';
            $html = preg_replace($pattern, $sigBox, $html);
        }

        return $html;
    }

    /**
     * Substitute one party's tokens (`{{customer.name}}`, `{{customer.email}}`,
     * etc.) into the HTML. Split out of replacePlaceholders so the agreement
     * render path can call it once per applicable party — Customer + Consignee
     * tokens both get resolved on a Buyer+Consignee agreement.
     */
    private function replacePartyNamespaceTokens(string $html, Model $party, string $modelName): string
    {
        // Each Eloquent class maps to one OR MORE user-facing token
        // namespaces because two pickers feed this resolver:
        //   - The trade-doc Insert Placeholder modal uses canonical
        //     `customer`, `consignee`, `supplier`.
        //   - The agreement Stage-2 wizard's PlaceholderPicker uses
        //     `buyer` (legacy alias for Customer), `consignee`,
        //     `supplier`.
        // Without the alias the agreement picker's `{{buyer.*}}` tokens
        // survive raw into the rendered PDF — that's why the Segment
        // Details preview was leaking placeholders.
        $partyToTokenNamespaces = [
            'Customer'  => ['customer', 'buyer'],
            'Consignee' => ['consignee'],
            'Vendor'    => ['supplier'],
        ];
        $namespaces = $partyToTokenNamespaces[$modelName] ?? null;
        if (empty($namespaces)) return $html;

        // Decode the common HTML entity variants of `{` and `}` so tokens
        // that came out of the contenteditable normalised (e.g. after
        // copy-paste from Word / Google Docs) still match the regex below.
        // Doing this on the body HTML is safe because braces have no
        // structural meaning in HTML — they only matter for our tokens.
        $html = str_replace(
            ['&#123;', '&#x7B;', '&#125;', '&#x7D;', '&lcub;', '&rcub;'],
            ['{',      '{',       '}',      '}',      '{',      '}'],
            $html,
        );

        $addr = $party->primaryAddress;   // null-safe via PHP 8 ?->

        // The three address tables don't share a shape:
        //   CustomerAddress / ConsigneeAddress → `country`, `state`, `pin`
        //                                        are plain string columns.
        //   VendorAddress                      → `country` / `state` are
        //                                        BelongsTo relationships
        //                                        (Countries / States) and
        //                                        pincode lives in `pincode`.
        // If we hand a model to e() the default __toString() returns its
        // JSON dump — that's why the rendered PDF was printing
        // `[{"id":15159,"client_id":null, …,"name":"India", …}]` in the
        // country / address cells. Coerce each value down to a plain
        // string before composition.
        $scalar = static function ($v): string {
            if ($v === null) return '';
            if (is_object($v)) return (string) ($v->name ?? '');
            return (string) $v;
        };

        $contactPerson = $modelName === 'Vendor' ? ($addr?->contact_name ?? '') : ($addr?->cp_name ?? '');
        $contactPhone  = $modelName === 'Vendor' ? ($addr?->contact_no  ?? '') : ($addr?->cp_contact ?? '');
        $countryStr = $scalar($addr?->country);
        $stateStr   = $scalar($addr?->state);
        $pinStr     = $scalar($modelName === 'Vendor' ? ($addr?->pincode ?? null) : ($addr?->pin ?? null));

        $addressLine = trim(implode(', ', array_filter([
            $addr?->address_line,
            $addr?->city,
            $stateStr,
            $countryStr,
            $pinStr,
        ])));

        $codeAttr = $modelName === 'Customer'  ? 'customer_code'
            : ($modelName === 'Consignee' ? 'consignee_code'
                : 'vendor_code');

        // Pre-compute resolved values for the canonical field names.
        $nameValue   = e($party->company_name ?? '');
        $codeValue   = e($party->{$codeAttr} ?? '');
        $cityValue   = e($scalar($addr?->city ?? null));

        // Field → resolved value. Includes:
        //   - canonical names trade-doc tokens use ({name, code, ...})
        //   - long-form aliases the agreement Stage-2 picker emits
        //     ({buyer_name, consignee_name, supplier_name, vendor_code})
        //   - picker fields that have no backing column yet (risk_level,
        //     role, category, bank_account) — resolved to empty strings
        //     so they at least disappear from the PDF instead of leaking
        //     `{{buyer.risk_level}}` raw text.
        // The regex below pairs each field with every namespace we know
        // for this model, so {{customer.name}} AND {{buyer.name}} AND
        // {{buyer.buyer_name}} all land on the same value.
        $values = [
            'name'            => $nameValue,
            'code'            => $codeValue,
            'buyer_name'      => $nameValue,
            'consignee_name'  => $nameValue,
            'supplier_name'   => $nameValue,
            // Long-form `*_code` aliases — the agreement Stage-2 picker
            // emits {{buyer.buyer_code}} (not {{buyer.code}}), and
            // symmetric aliases are added for consignee/supplier so
            // future picker entries resolve without another patch.
            'buyer_code'      => $codeValue,
            'consignee_code'  => $codeValue,
            'supplier_code'   => $codeValue,
            'vendor_code'     => $codeValue,
            'company'         => e(($party->legal_name ?: $party->company_name) ?? ''),
            'contact_person'  => e($contactPerson),
            'phone'           => e($contactPhone),
            'email'           => e($party->primary_email ?? ''),
            'country'         => e($countryStr),
            'state'           => e($stateStr),
            'city'            => $cityValue,
            'address'         => e($addressLine),
            'gst'             => '',
            'pan'             => '',
            'iec'             => '',
            'risk_level'      => '',
            'role'            => '',
            'category'        => '',
            'bank_account'    => '',
        ];

        foreach ($namespaces as $ns) {
            foreach ($values as $field => $value) {
                $pattern = '/\{\{\s*'
                    . preg_quote($ns,    '/') . '\s*\.\s*'
                    . preg_quote($field, '/') . '\s*\}\}/iu';
                $html = preg_replace($pattern, $value, $html);
            }
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
     *
     * The 'public' disk swaps driver based on FILESYSTEM_DISK:
     *   local mode → storage/app/public/uploads/signed_documents/…
     *   azure mode → blob:cbc-saas/uploads/signed_documents/…
     * Both code paths use the same Storage::disk('public') call, so the
     * diagnostic noise below is the only way to tell which step ate the
     * signed doc when only the certificate landed. Without it, the silent
     * try/catch produced an empty signed_document_paths array on server
     * and no clue why.
     */
    private function fetchSignedArtifacts(ClmSignatureRequest $row, array $details): void
    {
        $modelFolder = strtolower($row->model_name);
        $basePath    = 'uploads/signed_documents/' . $modelFolder;
        $diskName    = config('filesystems.disks.public.driver');
        $logCtx      = ['row_id' => $row->id, 'zoho_request_id' => $row->zoho_request_id, 'disk' => $diskName];

        // makeDirectory is a no-op on the azure-storage-blob adapter (blob
        // storage has no real directories — slashes in blob names are just
        // path-style prefixes), and a real mkdir on the local driver. Either
        // way, exists() before mkdir keeps the local path idempotent.
        try {
            if (!Storage::disk('public')->exists($basePath)) {
                Storage::disk('public')->makeDirectory($basePath);
            }
        } catch (\Throwable $e) {
            Log::warning('signed_doc fetch: makeDirectory failed', $logCtx + ['err' => $e->getMessage()]);
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
                // Step 1 — pull bytes from Zoho. This is the step that
                // most often fails on production: per-document endpoint
                // (/requests/{id}/documents/{docId}/pdf) needs the
                // ZohoSign.documents.READ scope; older refresh tokens
                // don't have it even when the certificate scope works.
                $bytes = $this->zoho->downloadDocumentPdf($row->zoho_request_id, $zohoId);
                if (!is_string($bytes) || $bytes === '') {
                    throw new RuntimeException('Zoho returned empty bytes');
                }

                // Step 2 — write to the active disk. put() returns false
                // instead of throwing because the public disk is configured
                // with throw=false, so we check the boolean explicitly.
                // Without this the next line would record an unverified
                // blob path and the UI would link to a 404.
                $safe     = Str::slug(pathinfo((string) $name, PATHINFO_FILENAME)) ?: ('document_' . ($i + 1));
                $fileName = sprintf('signed_%s_%d_%d.pdf', $safe, time(), $i);
                $path     = $basePath . '/' . $fileName;
                $ok       = Storage::disk('public')->put($path, $bytes);
                if ($ok === false) {
                    throw new RuntimeException('Storage::put returned false (disk=' . $diskName . ')');
                }

                // Step 3 — capture both `url` (legacy) and `file_url`
                // (new pattern used by other modules). On Azure the URL
                // is the absolute blob URL; on local it's /storage/…
                $publicUrl = Storage::disk('public')->url($path);
                $savedPaths[] = [
                    'zoho_document_id' => $zohoId,
                    'document_name'    => $name,
                    'path'             => $path,
                    'url'              => $publicUrl,
                    'file_url'         => $publicUrl,
                    'size'             => strlen($bytes),
                ];
                Log::info('signed_doc saved', $logCtx + ['zoho_doc_id' => $zohoId, 'path' => $path, 'size' => strlen($bytes)]);
            } catch (\Throwable $e) {
                // Log loudly so a server-only failure (Zoho scope, blob
                // container ACL, etc.) is visible in laravel.log instead
                // of being eaten silently.
                Log::error('signed_doc fetch failed', $logCtx + [
                    'zoho_doc_id' => $zohoId,
                    'err'         => $e->getMessage(),
                    'class'       => get_class($e),
                ]);
            }
        }

        if (!empty($savedPaths)) {
            $row->zoho_document_ids      = $zohoIds;
            $row->signed_document_paths  = $savedPaths;
            $row->signed_document_path   = $savedPaths[0]['path'] ?? null;
        } else {
            // Surface the empty-result case in the log so prod diagnosis
            // doesn't require diffing the row before/after every poll.
            Log::warning('signed_doc fetch produced no saved paths', $logCtx + ['expected_count' => count($zohoIds)]);
        }

        // Completion certificate is always one per request.
        try {
            $cert = $this->zoho->downloadCertificate($row->zoho_request_id);
            if (!is_string($cert) || $cert === '') {
                throw new RuntimeException('Zoho returned empty certificate bytes');
            }
            $safe     = Str::slug($row->request_name) ?: 'request';
            $certPath = $basePath . '/' . sprintf('certificate_%s_%d.pdf', $safe, time());
            $ok       = Storage::disk('public')->put($certPath, $cert);
            if ($ok === false) {
                throw new RuntimeException('Storage::put returned false (disk=' . $diskName . ')');
            }
            $row->certificate_path = $certPath;
            Log::info('certificate saved', $logCtx + ['path' => $certPath, 'size' => strlen($cert)]);
        } catch (\Throwable $e) {
            Log::error('certificate fetch failed', $logCtx + ['err' => $e->getMessage(), 'class' => get_class($e)]);
        }

        $row->save();
    }

    /**
     * Disk-scan fallback for completed rows that have no
     * `signed_document_paths` recorded in the DB.
     *
     * Production has hit a state where fetchSignedArtifacts uploads the
     * signed PDFs to Azure successfully (the blob container has files
     * like `signed_td-001-customer-trade-document_1779706863_0.pdf`)
     * but the row never gets the JSON column populated — the most
     * likely cause is a Zoho retry that throws AFTER the prior call's
     * blobs were written but BEFORE the save() runs. We can't fix that
     * race retroactively, so instead we recover at read time: list the
     * party's signed_documents folder, match each blob filename against
     * the request's document-name slugs, and synthesise the entries the
     * frontend expects.
     *
     * Cost: one Storage::allFiles() call per affected row. On Azure this
     * is a single LIST blob call against a tiny prefix
     * (`uploads/signed_documents/{party}/`), well within free-tier IOPS.
     *
     * Returns an empty array when nothing matches — caller falls back
     * to the existing "no attachment yet" UI without surprising the
     * user with files from a different request.
     *
     * @return array<int, array{path:string, url:?string, file_url:?string, document_name:string, zoho_document_id:?string}>
     */
    private function adoptSignedDocsFromDisk(ClmSignatureRequest $row): array
    {
        $names = is_array($row->document_names) ? $row->document_names : [];
        if (empty($names)) return [];

        $modelFolder = strtolower((string) $row->model_name);
        $basePath    = 'uploads/signed_documents/' . $modelFolder;

        try {
            if (!Storage::disk('public')->exists($basePath)) return [];
        } catch (\Throwable $e) {
            return [];
        }

        // Pull every signed_*.pdf in the party folder once. allFiles on
        // the Azure adapter returns absolute prefixes (no leading slash),
        // matching what fetchSignedArtifacts writes.
        try {
            $all = Storage::disk('public')->files($basePath);
        } catch (\Throwable $e) {
            Log::warning('adopt-from-disk: list failed', ['row_id' => $row->id, 'err' => $e->getMessage()]);
            return [];
        }

        $signedOnly = array_values(array_filter(
            $all,
            fn($p) => is_string($p)
                && str_contains($p, '/signed_')
                && str_ends_with(strtolower($p), '.pdf'),
        ));
        if (empty($signedOnly)) return [];

        $out = [];
        $zohoDocIds = is_array($row->zoho_document_ids) ? $row->zoho_document_ids : [];

        foreach ($names as $i => $rawName) {
            $slug = Str::slug(pathinfo((string) $rawName, PATHINFO_FILENAME));
            if ($slug === '') $slug = 'document-' . ($i + 1);
            $needle = '/signed_' . $slug . '_';

            // Newest match wins — fetchSignedArtifacts encodes the run
            // timestamp into the filename, so a higher numeric suffix is
            // always a later send.
            $candidates = array_values(array_filter(
                $signedOnly,
                fn($p) => str_contains($p, $needle),
            ));
            if (empty($candidates)) continue;
            usort($candidates, fn($a, $b) => strcmp($b, $a));
            $path = $candidates[0];

            $url = file_url($path);
            $out[] = [
                'zoho_document_id' => $zohoDocIds[$i] ?? null,
                'document_name'    => $rawName,
                'path'             => $path,
                'url'              => $url,
                'file_url'         => $url,
            ];
        }

        return $out;
    }
}
