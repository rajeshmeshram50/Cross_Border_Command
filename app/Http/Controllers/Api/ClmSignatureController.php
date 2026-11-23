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
use App\Models\LeadProduct;
use App\Models\Vendor;
use App\Services\ZohoSignService;
use App\Support\CtcAuditTime;
use Illuminate\Database\Eloquent\Model;
use Barryvdh\DomPDF\Facade\Pdf;
use Illuminate\Http\Request;
use App\Support\PdfHtml;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Cache;
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
            'trade_doc_id' => 'required_without:agreement_id|integer|exists:clm_trade_doc_library,id',
            'agreement_id' => 'required_without:trade_doc_id|integer|exists:clm_agreement_library,id',
            'party_id'     => 'required|integer',
            'model_name'   => 'nullable|string|in:Customer,Consignee,Vendor',
            'header_config_override' => 'nullable|array',
            'footer_config_override' => 'nullable|array',
            'content_override'       => 'nullable|string',
            'lead_id'                => 'nullable|integer|exists:leads,id',
        ]);
        $modelName = $data['model_name'] ?? 'Customer';

        $doc   = !empty($data['agreement_id'])
            ? tap(
                ClmAgreementLibrary::where('client_id', $user->client_id)->findOrFail($data['agreement_id']),
                fn($a) => $a->name = $a->title,
            )
            : ClmTradeDocLibrary::where('client_id', $user->client_id)->findOrFail($data['trade_doc_id']);
        $party = $this->loadParty($modelName, (int) $data['party_id'], $user);
        $lead  = !empty($data['lead_id'])
            ? Lead::where('client_id', $user->client_id)->find($data['lead_id'])
            : null;

        try {
            $bytes = $this->renderPdf(
                $doc,
                $party,
                $modelName,
                Str::uuid()->toString(),
                null,
                $data['header_config_override'] ?? null,
                $data['footer_config_override'] ?? null,
                $data['content_override'] ?? null,
                $lead,
            );
        } catch (\Throwable $e) {
            Log::error('Trade-doc preview render failed', [
                'doc_id'    => $doc->id,
                'doc_code'  => $doc->code ?? null,
                'party_id'  => $data['party_id'],
                'lead_id'   => $data['lead_id'] ?? null,
                'exception' => $e,
            ]);
            return response()->json([
                'message' => 'This document could not be rendered as a PDF. Open it in the editor and check its tables — a row or cell left outside a table is the usual cause.',
            ], 422);
        }

        return response($bytes, 200, [
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

    private function cleanSendError(\Throwable $e, string $fallback): string
    {
        $raw = $e->getMessage();
        $marker = 'Zoho Sign API error:';
        if (!str_contains($raw, $marker)) {
            return $fallback . ': ' . $raw;
        }
        $body    = trim((string) substr($raw, strpos($raw, $marker) + strlen($marker)));
        $decoded = json_decode($body, true);
        $zohoMsg = is_array($decoded) ? (string) ($decoded['message'] ?? '') : '';
        $low     = strtolower($zohoMsg . ' ' . $body);
        if (
            str_contains($low, 'already') || str_contains($low, 'processed')
            || str_contains($low, 'signed') || str_contains($low, 'completed')
            || str_contains($low, 'in progress') || str_contains($low, 'duplicate')
        ) {
            return 'This document has already been signed or is being processed in another tab or session. Refresh the page to see its current status.';
        }
        return $zohoMsg !== ''
            ? ('The e-signature service could not process this request: ' . $zohoMsg)
            : 'The e-signature service could not process this request right now. Please try again in a moment.';
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
            'trade_doc_ids'        => 'required_without:agreement_ids|array|max:10',
            'trade_doc_ids.*'      => 'integer|exists:clm_trade_doc_library,id',
            'agreement_ids'        => 'required_without:trade_doc_ids|array|max:10',
            'agreement_ids.*'      => 'integer|exists:clm_agreement_library,id',
            'party_id'             => 'required|integer',
            'model_name'           => 'nullable|string|in:Customer,Consignee,Vendor',
            'lead_id'              => 'nullable|integer|exists:leads,id',
            'signers'              => 'required|array|min:1|max:5',
            'signers.*.email'      => 'required|email',
            'signers.*.name'       => 'required|string|max:255',
            'signers.*.order'      => 'nullable|integer|min:1',
            'signers.*.role'       => 'nullable|string|max:32',
            'expiry_days'          => 'nullable|integer|min:1|max:90',
            'is_sequential'        => 'nullable|boolean',
            'notes'                => 'nullable|string|max:1000',
            'document_settings'    => 'nullable|array',
            'header_config_overrides'   => 'nullable|array',
            'footer_config_overrides'   => 'nullable|array',
            'content_overrides'         => 'nullable|array',

            'p2p_po_document_id'        => 'nullable|integer',
        ]);

        $modelName = $data['model_name'] ?? 'Customer';
        $party     = $this->loadParty($modelName, (int) $data['party_id'], $user);
        $lead      = !empty($data['lead_id'])
            ? Lead::where('client_id', $user->client_id)->find($data['lead_id'])
            : null;

        $tdIds  = array_values($data['trade_doc_ids'] ?? []);
        $agrIds = array_values($data['agreement_ids'] ?? []);
        $isMixed = $tdIds && $agrIds;

        $tdDocs = $tdIds
            ? ClmTradeDocLibrary::where('client_id', $user->client_id)->whereIn('id', $tdIds)->get()->keyBy('id')
            : collect();
        $agrDocs = $agrIds
            ? ClmAgreementLibrary::where('client_id', $user->client_id)->whereIn('id', $agrIds)->get()->keyBy('id')
            : collect();
        $tdDocs->each(function ($d) {
            $d->cbc_kind = ClmSignatureRequest::DOC_TRADE;
        });
        $agrDocs->each(function ($a) {
            $a->name = $a->title;
            $a->cbc_kind = ClmSignatureRequest::DOC_AGREEMENT;
        });

        if ($tdDocs->isEmpty() && $agrDocs->isEmpty()) {
            return response()->json(['status' => false, 'message' => 'No accessible documents in the selection.'], 422);
        }

        $orderedDocs = collect($tdIds)->map(fn($id) => $tdDocs->get($id))
            ->concat(collect($agrIds)->map(fn($id) => $agrDocs->get($id)))
            ->filter()
            ->values();

        $docKeyOf = function ($doc) use ($isMixed): string {
            return $isMixed ? ($doc->cbc_kind . ':' . $doc->id) : (string) $doc->id;
        };
        $perDocValue = function (array $map, $doc) use ($docKeyOf) {
            return $map[$docKeyOf($doc)] ?? $map[(string) $doc->id] ?? null;
        };

        $leadCustomer  = $lead && $lead->customer_id  ? Customer::query()->forUser($user)->find($lead->customer_id)   : null;
        $leadConsignee = $lead && $lead->consignee_id ? Consignee::query()->forUser($user)->find($lead->consignee_id) : null;
        $sameAsCustomer = $this->leadConsigneeIsCustomer($lead, $user);
        $signerKeyOf = function (?string $p) use ($leadCustomer, $leadConsignee, $party, $modelName, $sameAsCustomer): string {
            $tokens = collect(explode(',', (string) $p))
                ->map(fn($s) => strtolower(trim($s)))
                ->filter(fn($t) => in_array($t, ['buyer', 'consignee'], true));
            $buyerId = $leadCustomer?->primary_email
                ?: ($modelName === 'Customer' ? ($party->primary_email ?? null) : null);
            $consId  = $sameAsCustomer
                ? $buyerId
                : ($leadConsignee?->primary_email
                    ?: ($modelName === 'Consignee' ? ($party->primary_email ?? null) : null));
            return $tokens
                ->map(fn($t) => $t === 'buyer' ? $buyerId : $consId)
                ->filter()
                ->map(fn($e) => strtolower(trim((string) $e)))
                ->unique()->sort()->values()->implode(',');
        };
        $partyKeys = $orderedDocs->map(fn($d) => $signerKeyOf($d->party))->filter()->unique()->values();
        if ($partyKeys->count() > 1) {
            return response()->json([
                'status'  => false,
                'message' => 'A single signature request can only contain documents for the same applicable party. '
                    . 'Found a mix of: ' . $orderedDocs->pluck('party')->filter()->map(fn($p) => $this->partyLabel($p))->unique()->implode(' | ')
                    . '. Send each party group separately.',
            ], 422);
        }

        $seenSignerEmails = [];
        $data['signers'] = collect($data['signers'])
            ->filter(function ($s) use (&$seenSignerEmails) {
                $key = strtolower(trim((string) ($s['email'] ?? '')));
                if ($key === '' || in_array($key, $seenSignerEmails, true)) return false;
                $seenSignerEmails[] = $key;
                return true;
            })
            ->values()
            ->all();

        $tempPaths    = [];
        $localDocMeta = [];
        $requestUuid  = (string) Str::uuid();

        try {
            $headerByDoc  = (array) ($data['header_config_overrides'] ?? []);
            $footerByDoc  = (array) ($data['footer_config_overrides'] ?? []);
            $contentByDoc = (array) ($data['content_overrides']       ?? []);
            foreach ($orderedDocs as $doc) {
                $h              = $perDocValue($headerByDoc,  $doc);
                $f              = $perDocValue($footerByDoc,  $doc);
                $c              = $perDocValue($contentByDoc, $doc);
                $headerOverride = is_array($h)  ? $h : null;
                $footerOverride = is_array($f)  ? $f : null;
                $contentOver    = is_string($c) ? $c : null;
                $bytes = $this->renderPdf(
                    $doc,
                    $party,
                    $modelName,
                    $requestUuid,
                    $data['signers'],
                    $headerOverride,
                    $footerOverride,
                    $contentOver,
                    $lead,
                );
                $tmp  = storage_path('app/temp/' . Str::uuid()->toString() . '.pdf');
                file_put_contents($tmp, $bytes);
                $tempPaths[]     = $tmp;
                $localDocMeta[]  = [
                    'id'            => $doc->id,
                    'document_name' => $doc->code ? "{$doc->code} {$doc->name}" : $doc->name,
                ];
            }

            if (!empty($data['p2p_po_document_id'])) {
                $p2pDoc = \App\Models\P2p\PurchaseOrderDocument::withoutGlobalScope('tenant')
                    ->where('client_id', $user->client_id)
                    ->where('doc_kind', 'purchase_order')
                    ->find($data['p2p_po_document_id']);
                $disk = Storage::disk('public');

                if ($p2pDoc && $p2pDoc->file_path && $disk->exists($p2pDoc->file_path)) {
                    $poTmp = storage_path('app/temp/' . Str::uuid()->toString() . '.pdf');
                    file_put_contents($poTmp, $disk->get($p2pDoc->file_path));
                    $tempPaths[]    = $poTmp;
                    $poCode         = $p2pDoc->purchaseOrder?->code ?: $p2pDoc->code;
                    $localDocMeta[] = [
                        'id'            => 'po',
                        'document_name' => 'Purchase Order ' . $poCode,
                    ];
                } elseif ($p2pDoc) {
                    throw new \RuntimeException('The purchase order PDF is not ready yet. Open Stage 04, wait for it to generate, then send again.');
                }
            }

            $expiryDays = min(90, max(1, (int) ($data['expiry_days'] ?? 30)));
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

            $createResp     = $this->zoho->createRequestMultipart($tempPaths, $filenames, $requestBody);
            $zohoRequestId  = data_get($createResp, 'requests.request_id');
            if (!$zohoRequestId) {
                throw new RuntimeException('Zoho create-request did not return a request_id: ' . json_encode($createResp));
            }

            [$zohoActions, $zohoDocumentIds] = $this->zohoRequestShape($createResp, (string) $zohoRequestId);

            $signersByEmail = collect($data['signers'])
                ->keyBy(fn($s) => strtolower((string) ($s['email'] ?? '')));
            foreach ($zohoActions as &$zohoAction) {
                $email = strtolower((string) ($zohoAction['recipient_email'] ?? ''));
                $match = $signersByEmail->get($email);
                if (is_array($match) && !empty($match['role'])) {
                    $zohoAction['cbc_role'] = (string) $match['role'];
                }
            }
            unset($zohoAction);

            $cbcDocIdsOrdered = $orderedDocs->map(fn($d) => $docKeyOf($d))->all();
            if (in_array('po', array_column($localDocMeta, 'id'), true)) $cbcDocIdsOrdered[] = 'po';
            $perDocCoords = $this->mapClientCoordsToZohoDocIds(
                (array) ($data['document_settings'] ?? []),
                $cbcDocIdsOrdered,
                $zohoDocumentIds
            );

            $submitResp = $this->zoho->submitWithFields($zohoRequestId, $zohoActions, $zohoDocumentIds, $perDocCoords);
            $submitted  = isset($submitResp['requests']);

            $finalStatus = 'draft';
            if ($submitted) {
                $finalStatus = $this->awaitSubmittedStatus($zohoRequestId);
            }

            $sigReq = new ClmSignatureRequest();
            $sigReq->client_id           = $user->client_id;
            $sigReq->branch_id           = $user->branch_id ?? null;
            $sigReq->document_type       = $tdIds ? ClmSignatureRequest::DOC_TRADE : ClmSignatureRequest::DOC_AGREEMENT;
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
            $sigReq->signers             = $this->withPlacements((array) $data['signers'], (array) ($data['document_settings'] ?? []));
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
                'doc_kind_ids'      => array_filter([
                    ClmSignatureRequest::DOC_TRADE     => $orderedDocs->where('cbc_kind', ClmSignatureRequest::DOC_TRADE)->pluck('id')->values()->all(),
                    ClmSignatureRequest::DOC_AGREEMENT => $orderedDocs->where('cbc_kind', ClmSignatureRequest::DOC_AGREEMENT)->pluck('id')->values()->all(),
                ]),
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
            return response()->json(['status' => false, 'message' => $this->cleanSendError($e, 'Failed to send documents')], 500);
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
            'header_config_override'  => 'nullable|array',
            'footer_config_override'  => 'nullable|array',
            'content_override'        => 'nullable|string',
        ]);

        $agreement = ClmAgreementLibrary::where('client_id', $user->client_id)
            ->findOrFail($data['agreement_id']);
        $lead = Lead::where('client_id', $user->client_id)->findOrFail($data['lead_id']);

        [$primary, $primaryModel, $signers, $allParties] = $this->resolveAgreementSigners($agreement, $lead, $user);

        if (!$primary) {
            return response()->json(['status' => false, 'message' => 'No customer/consignee on this lead to render the agreement against.'], 422);
        }

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

        $bytes = $this->renderAgreementPdf(
            $agreement,
            $primary,
            $primaryModel,
            Str::uuid()->toString(),
            $signers,
            $data['header_config_override'] ?? null,
            $data['footer_config_override'] ?? null,
            array_key_exists('content_override', $data) ? (string) $data['content_override'] : null,
            $allParties,
            $lead,
        );

        return response($bytes, 200, [
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
            'agreement_id'      => 'nullable|integer|exists:clm_agreement_library,id',
            'agreement_ids'     => 'nullable|array|min:1|max:10',
            'agreement_ids.*'   => 'integer|exists:clm_agreement_library,id',
            'lead_id'           => 'required|integer|exists:leads,id',
            'expiry_days'       => 'nullable|integer|min:1|max:90',
            'is_sequential'     => 'nullable|boolean',
            'notes'             => 'nullable|string|max:1000',
            'document_settings' => 'nullable|array',
            'header_config_overrides'   => 'nullable|array',
            'footer_config_overrides'   => 'nullable|array',
            'content_overrides'         => 'nullable|array',
        ]);

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

        $orderedAgreements = collect($ids)
            ->map(fn($id) => $agreements->get($id))
            ->filter()
            ->values();

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
                    . $orderedAgreements->pluck('party')->map(fn($p) => $this->partyLabel($p))->unique()->implode(' | '),
            ], 422);
        }

        $headAgreement = $orderedAgreements->first();
        [$primary, $primaryModel, $signers, $allParties] = $this->resolveAgreementSigners($headAgreement, $lead, $user);

        if (!$primary || empty($signers)) {
            return response()->json([
                'status'  => false,
                'message' => 'No signer could be resolved — the agreement\'s applicable party (' . $this->partyLabel($headAgreement->party) . ') does not match a customer/consignee on this lead.',
            ], 422);
        }

        $seenAgreementEmails = [];
        $signers = collect($signers)
            ->filter(function ($s) use (&$seenAgreementEmails) {
                $key = strtolower(trim((string) ($s['email'] ?? '')));
                if ($key === '' || in_array($key, $seenAgreementEmails, true)) return false;
                $seenAgreementEmails[] = $key;
                return true;
            })
            ->values()
            ->all();

        $requestUuid  = (string) Str::uuid();
        $tempPaths    = [];
        $localDocMeta = [];

        $headerOverrides  = (array) ($data['header_config_overrides'] ?? []);
        $footerOverrides  = (array) ($data['footer_config_overrides'] ?? []);
        $contentOverrides = (array) ($data['content_overrides']       ?? []);
        $pickOverride = function (array $bag, int $aid) {
            return $bag[$aid] ?? $bag[(string) $aid] ?? null;
        };

        try {
            foreach ($orderedAgreements as $a) {
                $headerOverride  = $pickOverride($headerOverrides,  $a->id);
                $footerOverride  = $pickOverride($footerOverrides,  $a->id);
                $contentOverride = $pickOverride($contentOverrides, $a->id);
                $bytes = $this->renderAgreementPdf(
                    $a,
                    $primary,
                    $primaryModel,
                    $requestUuid,
                    $signers,
                    is_array($headerOverride) ? $headerOverride : null,
                    is_array($footerOverride) ? $footerOverride : null,
                    $contentOverride !== null ? (string) $contentOverride : null,
                    $allParties,
                    $lead,
                );
                $tmp = storage_path('app/temp/' . Str::uuid()->toString() . '.pdf');
                file_put_contents($tmp, $bytes);
                $tempPaths[]    = $tmp;
                $localDocMeta[] = [
                    'id'            => $a->id,
                    'document_name' => $a->code ? "{$a->code} {$a->title}" : $a->title,
                ];
            }

            $expiryDays = min(90, max(1, (int) ($data['expiry_days'] ?? 30)));
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

            $createResp    = $this->zoho->createRequestMultipart($tempPaths, $filenames, $requestBody);
            $zohoRequestId = data_get($createResp, 'requests.request_id');
            if (!$zohoRequestId) {
                throw new RuntimeException('Zoho create-request did not return a request_id: ' . json_encode($createResp));
            }

            [$zohoActions, $zohoDocumentIds] = $this->zohoRequestShape($createResp, (string) $zohoRequestId);

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

            $finalStatus = 'draft';
            if ($submitted) {
                $finalStatus = $this->awaitSubmittedStatus($zohoRequestId);
            }

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
            $sigReq->signers           = $this->withPlacements($signers, (array) ($data['document_settings'] ?? []));
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
            return response()->json(['status' => false, 'message' => $this->cleanSendError($e, 'Failed to send agreement')], 500);
        } finally {
            foreach ($tempPaths as $p) {
                @unlink($p);
            }
        }
    }

    public function ctcPreview(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);
        $data = $request->validate([
            'contract_id'            => 'required|integer',
            'header_config_override' => 'nullable|array',
            'footer_config_override' => 'nullable|array',
            'content_override'       => 'nullable|string',
        ]);
        $c = CtcContract::where('client_id', $user->client_id)->findOrFail($data['contract_id']);

        $isFinishedDocument = ($data['header_config_override'] ?? null) === null
            && ($data['footer_config_override'] ?? null) === null
            && !array_key_exists('content_override', $data);

        $bytes = $this->renderCtcPdf(
            $c,
            [],
            $data['header_config_override'] ?? null,
            $data['footer_config_override'] ?? null,
            array_key_exists('content_override', $data) ? (string) $data['content_override'] : null,
            Str::uuid()->toString(),
            $isFinishedDocument ? 60 * 24 * 7 : 30,
        );
        return response($bytes, 200, [
            'Content-Type'        => 'application/pdf',
            'Content-Disposition' => 'inline; filename="ctc-preview-' . ($c->code ?: $c->id) . '.pdf"',
            'Cache-Control'       => 'no-store',
        ]);
    }

    public function ctcSend(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);
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
            'expiry_days'            => 'nullable|integer|min:1|max:90',
            'is_sequential'          => 'nullable|boolean',
            'notes'                  => 'nullable|string|max:1000',
            'document_settings'      => 'nullable|array',
            'header_config_override' => 'nullable|array',
            'footer_config_override' => 'nullable|array',
            'content_override'       => 'nullable|string',
        ]);

        $c = CtcContract::where('client_id', $user->client_id)->findOrFail($data['contract_id']);

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
            $bytes = $this->renderCtcPdf(
                $c,
                $signers,
                $data['header_config_override'] ?? null,
                $data['footer_config_override'] ?? null,
                array_key_exists('content_override', $data) ? (string) $data['content_override'] : null,
                $requestUuid,
            );
            $tmp = storage_path('app/temp/' . Str::uuid()->toString() . '.pdf');
            file_put_contents($tmp, $bytes);
            $tempPaths[] = $tmp;

            $expiryDays = min(90, max(1, (int) ($data['expiry_days'] ?? ($c->days_to_sign ?: 30))));
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

            [$zohoActions, $zohoDocumentIds] = $this->zohoRequestShape($createResp, (string) $zohoRequestId);

            $signersByEmail = collect($signers)->keyBy(fn($s) => strtolower((string) ($s['email'] ?? '')));
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
                $finalStatus = $this->awaitSubmittedStatus($zohoRequestId);
            }

            $sigReq = new ClmSignatureRequest();
            $sigReq->client_id         = $user->client_id;
            $sigReq->branch_id         = $user->branch_id ?? null;
            $sigReq->document_type     = 'ctc';
            $sigReq->trade_doc_id      = $c->id;
            $sigReq->trade_doc_ids     = [$c->id];
            $sigReq->document_names    = [$requestName];
            $sigReq->zoho_document_ids = array_values(array_filter(array_map(fn($d) => $d['document_id'] ?? null, $zohoDocumentIds)));
            $sigReq->model_name        = 'CtcContract';
            $sigReq->party_id          = $c->id;
            $sigReq->zoho_request_id   = $zohoRequestId;
            $sigReq->request_name      = $requestName;
            $sigReq->status            = $finalStatus;
            $sigReq->signers           = $this->withPlacements($signers, (array) ($data['document_settings'] ?? []));
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

            $perSigner = (array) (($data['document_settings'] ?? [])[$c->id]
                ?? ($data['document_settings'] ?? [])[(string) $c->id] ?? []);
            $recipients = collect($signers)->map(function ($s) use ($perSigner) {
                $coords = (array) ($perSigner[$s['role']] ?? []);
                $boxes  = (isset($coords['boxes']) && is_array($coords['boxes']) && $coords['boxes'])
                    ? array_values(array_filter($coords['boxes'], 'is_array'))
                    : ($coords ? [$coords] : []);
                return [
                    'name' => $s['name'],
                    'email' => $s['email'],
                    'role' => $s['role'],
                    'contact' => $s['name'],
                    'signed' => false,
                    'signed_at' => null,
                    'placements' => array_map(fn($b) => (int) ($b['page'] ?? 0) + 1, $boxes),
                ];
            })->all();
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
                'status' => 'Sent for Signing',
                'date' => now()->format('d M Y H:i'),
                'by' => $user->name ?? '',
                'content' => $c->content,
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
            return response()->json(['status' => false, 'message' => $this->cleanSendError($e, 'Failed to send for signature')], 500);
        } finally {
            foreach ($tempPaths as $p) @unlink($p);
        }
    }

    public function ctcSignatureStatus(Request $request, int $id)
    {
        $user = $request->user();
        if (!$user) abort(401);
        $c = CtcContract::where('client_id', $user->client_id)->findOrFail($id);
        if ($c->zoho_request_id) {
            try {
                $details   = $this->zoho->getRequest($c->zoho_request_id);
                $reqStatus = strtolower((string) data_get($details, 'requests.request_status', 'inprogress'));
                $pickReason = function (array $a): string {
                    foreach (['reason', 'reject_reason', 'rejection_reason', 'decline_reason', 'declined_reason', 'recipient_comment', 'comments', 'comment', 'action_comment'] as $k) {
                        if (!empty($a[$k])) return (string) $a[$k];
                    }
                    return '';
                };
                $reqLevelReason = '';
                foreach (['reason', 'reject_reason', 'declined_reason', 'decline_reason'] as $k) {
                    $rv = data_get($details, "requests.$k");
                    if (!empty($rv)) {
                        $reqLevelReason = (string) $rv;
                        break;
                    }
                }
                $byEmail = [];
                foreach (data_get($details, 'requests.actions', []) as $a) {
                    $email = strtolower((string) ($a['recipient_email'] ?? ''));
                    $byEmail[$email] = ['status' => strtolower((string) ($a['action_status'] ?? '')), 'reason' => $pickReason((array) $a), 'raw' => $a];
                }
                $recipients = array_values($c->signing_recipients ?? []);
                $stamp = now()->format('d M Y H:i');
                $declinedReason = null;
                $declinedBy = null;
                foreach ($recipients as &$r) {
                    $a  = $byEmail[strtolower((string) ($r['email'] ?? ''))] ?? ['status' => '', 'reason' => '', 'raw' => []];
                    $st = $a['status'];
                    if (in_array($st, ['signed', 'completed', 'approved']) && empty($r['signed'])) {
                        $r['signed'] = true;
                        $r['signed_at'] = $stamp;
                        $r['declined'] = false;
                    }
                    if (in_array($st, ['declined', 'rejected', 'recalled'])) {
                        Log::info('CTC signer declined', ['contract' => $c->id, 'email' => $r['email'] ?? null, 'action' => $a['raw']]);
                        $reason = $a['reason'] ?: $reqLevelReason ?: ($r['decline_reason'] ?? '');
                        $r['declined'] = true;
                        $r['signed'] = false;
                        $r['decline_reason'] = $reason;
                        $declinedReason = $reason;
                        $declinedBy = $r['name'] ?? $r['email'] ?? null;
                    }
                }
                unset($r);
                $isDeclined = $declinedBy !== null || in_array($reqStatus, ['declined', 'rejected', 'recalled', 'expired']);
                $allSigned  = !$isDeclined && count($recipients) > 0 && collect($recipients)->every(fn($r) => !empty($r['signed']));

                if ($isDeclined && empty($c->signature_declined_at)) {
                    $c->signature_declined_at = now();
                    $expired  = $reqStatus === 'expired' && $declinedBy === null;
                    $voidWhy  = $expired
                        ? 'Signing request expired'
                        : ($declinedReason ?: 'Declined by ' . ($declinedBy ?: 'a signer'));
                    $this->ctcVoidSignatureRequest($c, $voidWhy);
                    $this->ctcPushVersion($c, ($expired ? 'Signing request expired' : 'Declined by ' . ($declinedBy ?: 'a signer') . ($declinedReason ? ' — ' . $declinedReason : '')), ($expired ? 'Expired' : 'Declined'), $declinedBy ?: 'Signer');
                } elseif (!$isDeclined) {
                    $c->signature_declined_at = null;
                }
                if ($reqStatus === 'completed' || $allSigned) {
                    foreach ($recipients as &$r2) {
                        if (empty($r2['signed'])) {
                            $r2['signed'] = true;
                            $r2['signed_at'] = $stamp;
                        }
                    }
                    unset($r2);
                    if (!$c->cp_signed_date) $c->cp_signed_date = now();
                    if ($c->signature_request_id) {
                        $sr = ClmSignatureRequest::find($c->signature_request_id);
                        if ($sr) {
                            if ($sr->status !== 'completed') {
                                $sr->status = 'completed';
                                if (!$sr->completed_at) $sr->completed_at = now();
                                $sr->save();
                            }
                            if (empty($sr->fresh()->signed_document_paths)) {
                                try {
                                    $this->fetchSignedArtifacts($sr, $details);
                                } catch (\Throwable $e) {
                                    Log::warning('CTC signed artifact fetch failed: ' . $e->getMessage());
                                }
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
        $c->content_preview = $c->content ? $this->resolveCtcContent((string) $c->content, $c, true) : '';
        $c->versions       = $this->istCtcEntries($c->versions ?? []);
        $c->clarifications = $this->istCtcEntries($c->clarifications ?? []);
        $c->approvers      = $this->istCtcEntries($c->approvers ?? []);
        return response()->json(['status' => true, 'data' => $c]);
    }

    private function ctcSignedDocumentUrl(CtcContract $c): ?string
    {
        if (!$c->signature_request_id) return null;
        $sr = ClmSignatureRequest::find($c->signature_request_id);
        $paths = is_array($sr?->signed_document_paths) ? $sr->signed_document_paths : [];
        $first = $paths[0] ?? null;
        if (!is_array($first)) return null;
        return $first['file_url'] ?? $first['url'] ?? (isset($first['path']) ? file_url($first['path']) : null);
    }

    public function ctcRemindSigning(Request $request, int $id)
    {
        $user = $request->user();
        if (!$user) abort(401);
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

    private function renderCtcPdf(CtcContract $c, array $signers, ?array $headerOverride, ?array $footerOverride, ?string $contentOverride, string $requestUuid, int $cacheMinutes = 30)
    {
        @ini_set('memory_limit', '1024M');
        @set_time_limit(180);

        $sourceHtml = $contentOverride !== null ? $contentOverride : (string) $c->content;
        $sig = $this->ctcOrgSignatureDataUri($c);
        $sigHtml = $sig ? '<img src="' . $sig . '" alt="Authorised Signatory" style="display:block;max-height:80px;max-width:210px;object-fit:contain;margin:8px 0 6px;" />' : '';
        $processedHtml = preg_replace('/\{\{\s*signature\s*\}\}/i', $sigHtml, $sourceHtml);
        $processedHtml = $this->resolveCtcContent($processedHtml, $c);

        $client = Client::find($c->client_id);
        $headerConfig = is_array($headerOverride) ? $headerOverride : (is_array($c->header_config) ? $c->header_config : []);
        $footerConfig = is_array($footerOverride) ? $footerOverride : (is_array($c->footer_config) ? $c->footer_config : []);
        $headerLogoBase64 = $this->resolveLogoBase64(
            $headerConfig['logo_path'] ?? null,
            $this->pathFromStorageUrl($headerConfig['logo_url'] ?? null),
            $client?->logo,
        );

        $cacheKey = 'clm:ctcpdf:' . sha1(implode('|', [
            (int) $c->client_id,
            (int) $c->id,
            (string) $c->updated_at,
            md5($processedHtml),
            md5((string) json_encode($headerConfig)),
            md5((string) json_encode($footerConfig)),
            md5((string) json_encode($c->page_config ?? [])),
            md5((string) $headerLogoBase64),
            md5((string) json_encode($signers)),
            (string) ($client->updated_at ?? ''),
        ]));

        try {
            if ($hit = Cache::get($cacheKey)) {
                return base64_decode($hit);
            }
        } catch (\Throwable $e) {
        }

        $bytes = Pdf::loadView('pdf.clm-signature-document', [
            'document'         => $c,
            'party'            => null,
            'modelName'        => '',
            'processedHtml'    => $processedHtml,
            'generatedDate'    => now()->format('d/m/Y'),
            'requestId'        => substr($requestUuid, 0, 8),
            'signers'          => $signers,
            'client'           => $client,
            'headerConfig'     => $headerConfig,
            'pageConfig'       => is_array($c->page_config ?? null) ? $c->page_config : [],
            'footerConfig'     => $footerConfig,
            'headerLogoBase64' => $headerLogoBase64,
        ])->setPaper('a4')->setOption('isPhpEnabled', true)->output();

        if (strlen($bytes) <= 5 * 1024 * 1024) {
            try {
                Cache::put($cacheKey, base64_encode($bytes), now()->addMinutes($cacheMinutes));
            } catch (\Throwable $e) {
            }
        }

        return $bytes;
    }

    private function resolveCtcContent(string $html, CtcContract $c, bool $keepSignature = false): string
    {
        foreach ($this->ctcOrgBranchTokens($c) as $tok => $val) {
            $html = preg_replace('/\{\{\s*' . $tok . '\s*\}\}/i', e((string) $val), $html);
        }

        foreach ((is_array($c->counterparties) ? $c->counterparties : []) as $cp) {
            $type = strtolower((string) ($cp['source_type'] ?? ''));
            $id   = $cp['source_id'] ?? null;
            $dbId = $cp['source_db_id'] ?? null;
            if ($type === '') continue;
            if (($id === null || $id === '') && ($dbId === null || $dbId === '')) continue;
            [$model, $modelName] = $this->ctcLivePartyModel($type, $id, (int) $c->client_id, $dbId, $c->branch_id);
            if ($model) $html = self::replacePartyNamespaceTokens($html, $model, $modelName);
        }

        $pattern = $keepSignature ? '/\{\{\s*(?!signature\s*\}\})[^{}]*\}\}/i' : '/\{\{[^{}]*\}\}/';
        return preg_replace($pattern, '', $html);
    }

    private function ctcLivePartyRow($q, $id, string $codeCol, $dbId = null, $branchId = null)
    {
        if ($dbId !== null && $dbId !== '' && (int) $dbId > 0) {
            $row = (clone $q)->find((int) $dbId);
            if ($row) return $row;
        }
        if (is_numeric($id)) return (clone $q)->find($id);
        if ($id === null || $id === '') return null;
        if ($branchId !== null) {
            $row = (clone $q)->where($codeCol, $id)->where('branch_id', $branchId)->first();
            if ($row) return $row;
        }
        return (clone $q)->where($codeCol, $id)->first();
    }

    private function ctcLivePartyModel(string $type, $id, int $clientId, $dbId = null, $branchId = null): array
    {
        if ($type === 'buyer' || $type === 'customer') {
            $q = \App\Models\Customer::where('client_id', $clientId)->with('primaryAddress');
            $row = $this->ctcLivePartyRow($q, $id, 'customer_code', $dbId, $branchId);
            return $row ? [$row, 'Customer'] : [null, ''];
        }
        if ($type === 'consignee') {
            $q = \App\Models\Consignee::where('client_id', $clientId)->with('primaryAddress');
            $row = $this->ctcLivePartyRow($q, $id, 'consignee_code', $dbId, $branchId);
            return $row ? [$row, 'Consignee'] : [null, ''];
        }
        if ($type === 'supplier' || $type === 'vendor') {
            $q = \App\Models\Vendor::where('client_id', $clientId)->with('primaryAddress');
            $row = $this->ctcLivePartyRow($q, $id, 'vendor_code', $dbId, $branchId);
            return $row ? [$row, 'Vendor'] : [null, ''];
        }
        return [null, ''];
    }

    private function istCtcEntries($arr): array
    {
        return CtcAuditTime::entries($arr);
    }

    private function ctcVoidSignatureRequest(CtcContract $c, string $reason): void
    {
        if (!$c->signature_request_id) return;
        $row = ClmSignatureRequest::find($c->signature_request_id);
        if ($row) $this->voidSignatureRequest($row, $reason);
    }

    private function withPlacements(array $signers, array $documentSettings): array
    {
        $pagesFor = function (?string $role) use ($documentSettings): array {
            $pages = [];
            foreach ($documentSettings as $coords) {
                if (!is_array($coords)) continue;
                $slice = ($role !== null && isset($coords[$role]) && is_array($coords[$role]))
                    ? $coords[$role]
                    : (isset($coords['x']) ? $coords : null);
                if (!is_array($slice)) continue;
                $boxes = (isset($slice['boxes']) && is_array($slice['boxes']) && $slice['boxes'])
                    ? array_values(array_filter($slice['boxes'], 'is_array'))
                    : [$slice];
                foreach ($boxes as $b) $pages[] = (int) ($b['page'] ?? 0) + 1;
            }
            return $pages;
        };

        return array_map(function ($s) use ($pagesFor) {
            if (!is_array($s)) return $s;
            $s['placements'] = $pagesFor(isset($s['role']) ? (string) $s['role'] : null);
            return $s;
        }, $signers);
    }

    private function voidSignatureRequest(ClmSignatureRequest $row, string $reason): void
    {
        if (in_array($row->status, ['recalled', 'completed'], true)) return;

        if ($row->zoho_request_id) {
            try {
                $this->zoho->recall($row->zoho_request_id, mb_substr($reason, 0, 500));
            } catch (\Throwable $e) {
                Log::info('Signature void: Zoho recall refused', [
                    'request' => $row->id,
                    'zoho'    => $row->zoho_request_id,
                    'error'   => $e->getMessage(),
                ]);
            }
        }

        $row->recalled_at   = $row->recalled_at ?: now();
        $row->recall_reason = $reason;
        if (!in_array($row->status, ['declined', 'rejected'], true)) $row->status = 'recalled';
        $row->save();
    }

    private function ctcPushVersion(CtcContract $c, string $label, string $status, string $by): void
    {
        $versions = array_values($c->versions ?? []);
        $versions[] = [
            'v' => count($versions) + 1,
            'label' => $label,
            'status' => $status,
            'date' => now()->format('d M Y H:i'),
            'by' => $by,
            'content' => $c->content,
        ];
        $c->versions = $versions;
    }

    private function resolveCtcOrgBranch(CtcContract $c): ?Branch
    {
        $orgName = trim((string) ($c->org_name ?? ''));
        $branch = $orgName !== ''
            ? Branch::where('client_id', $c->client_id)->where('name', $orgName)->first()
            : null;
        return $branch ?: ($c->branch_id ? Branch::find($c->branch_id) : null);
    }

    private function ctcBranchAddress(?Branch $b): string
    {
        if (!$b) return '';
        return trim(implode(', ', array_filter([
            trim((string) $b->address),
            trim((string) $b->city),
            trim((string) $b->state),
            trim(trim((string) $b->pincode) . ' ' . trim((string) $b->country)),
        ], fn($v) => $v !== '')), ', ');
    }

    private function ctcOrgBranchTokens(CtcContract $c): array
    {
        $b = $this->resolveCtcOrgBranch($c);
        return [
            'company_name' => $c->org_name ?: ($b->name ?? ''),
            'company_no'   => $b->cin ?? '',
            'email'        => $b->email ?? '',
            'contact_no'   => $b->phone ?? '',
            'address'      => $this->ctcBranchAddress($b),
        ];
    }

    private function ctcOrgSignatureDataUri(CtcContract $c): ?string
    {
        $branch = $this->resolveCtcOrgBranch($c);
        $path = $branch?->signature_path;
        if (!$path) return null;
        if (preg_match('#/storage/(.+)$#', (string) $path, $m)) $path = $m[1];
        try {
            if (!Storage::disk('public')->exists($path)) return null;
            $data = base64_encode(Storage::disk('public')->get($path));
            $ext  = strtolower(pathinfo($path, PATHINFO_EXTENSION) ?: 'png');
            $mime = in_array($ext, ['jpg', 'jpeg']) ? 'image/jpeg' : ($ext === 'webp' ? 'image/webp' : 'image/png');
            return "data:$mime;base64,$data";
        } catch (\Throwable $e) {
            return null;
        }
    }

    public function salesDocSigners(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);
        if (!$user->client_id) return response()->json(['status' => false, 'message' => 'No tenant context'], 403);

        $data = $request->validate([
            'doc_kind' => 'required|string|in:quotation,proforma_invoice',
            'doc_id'   => 'required|integer',
        ]);

        $record = $data['doc_kind'] === 'quotation'
            ? \App\Models\Quotation::where('client_id', $user->client_id)->with('customer.primaryAddress')->find($data['doc_id'])
            : \App\Models\ProformaInvoice::where('client_id', $user->client_id)->with('customer.primaryAddress')->find($data['doc_id']);
        if (!$record) return response()->json(['status' => false, 'message' => 'Document not found.'], 404);

        return response()->json([
            'status' => true,
            'data'   => $this->resolveSalesDocSigners($record, null),
        ]);
    }

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
            'lead_id'           => 'nullable|integer|exists:leads,id',
            'signers'           => 'nullable|array|max:5',
            'signers.*.role'    => 'nullable|string|max:32',
            'signers.*.email'   => 'required_with:signers|email',
            'signers.*.name'    => 'nullable|string|max:255',
            'signers.*.order'   => 'nullable|integer|min:1',
            'document_settings' => 'nullable|array',
            'expiry_days'       => 'nullable|integer|min:1|max:90',
            'is_sequential'     => 'nullable|boolean',
            'notes'             => 'nullable|string|max:1000',
        ]);

        $docKind = $data['doc_kind'];
        $docId   = (int) $data['doc_id'];

        $liveDocType = $docKind === 'quotation'
            ? ClmSignatureRequest::DOC_QUOTATION
            : ClmSignatureRequest::DOC_PROFORMA_INVOICE;
        $live = ClmSignatureRequest::where('client_id', $user->client_id)
            ->where('document_type', $liveDocType)
            ->where('trade_doc_id', $docId)
            ->whereIn('status', ['draft', 'inprogress'])
            ->whereNull('deleted_at')
            ->first();
        if ($live) {
            return response()->json([
                'status'  => false,
                'message' => 'This document has already been sent for signature and is awaiting a response. '
                    . 'Recall the existing request before sending it again.',
                'data'    => ['signature_request_id' => $live->id],
            ], 409);
        }
        $lead    = !empty($data['lead_id'])
            ? Lead::where('client_id', $user->client_id)->findOrFail($data['lead_id'])
            : null;

        try {
            $rendered = app(SalesPdfController::class)->renderSalesDocPdfToTemp($docKind, $docId, $user, true);
        } catch (\Illuminate\Database\Eloquent\ModelNotFoundException $e) {
            return response()->json(['status' => false, 'message' => 'Document not found.'], 404);
        }
        $tempPath = $rendered['path'];
        $record   = $rendered['record'];

        if (!$lead && !empty($record->opp_id)) {
            $lead = Lead::where('client_id', $user->client_id)->find($record->opp_id);
        }
        if ($lead && (int) ($record->opp_id ?? 0) !== (int) $lead->id) {
            @unlink($tempPath);
            return response()->json(['status' => false, 'message' => 'This document does not belong to the supplied opportunity.'], 422);
        }

        try {
            $signers = $this->resolveSalesDocSigners($record, $data['signers'] ?? null);
            if (empty($signers)) {
                @unlink($tempPath);
                return response()->json([
                    'status'  => false,
                    'message' => 'No signer could be resolved — the customer (or a selected signer) has no email on this document.',
                ], 422);
            }

            $primaryIsCustomer = (int) ($record->customer_id ?? 0) > 0;
            $primaryId         = $primaryIsCustomer ? (int) $record->customer_id : (int) ($record->consignee_id ?? 0);

            $expiryDays  = min(90, max(1, (int) ($data['expiry_days'] ?? 30)));
            $shortLabel  = $docKind === 'quotation' ? 'QT' : 'PI';
            $docName     = $record->code ? "{$shortLabel} {$record->code}" : $rendered['filename'];
            $requestName = $record->code ?: $rendered['filename'];

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

            $createResp    = $this->zoho->createRequestMultipart([$tempPath], [$rendered['filename']], $requestBody);
            $zohoRequestId = data_get($createResp, 'requests.request_id');
            if (!$zohoRequestId) {
                throw new RuntimeException('Zoho create-request did not return a request_id: ' . json_encode($createResp));
            }

            [$zohoActions, $zohoDocumentIds] = $this->zohoRequestShape($createResp, (string) $zohoRequestId);

            $signersByEmail = collect($signers)->keyBy(fn($s) => strtolower((string) ($s['email'] ?? '')));
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
                [$docId],
                $zohoDocumentIds
            );

            $submitResp = $this->zoho->submitWithFields($zohoRequestId, $zohoActions, $zohoDocumentIds, $perDocCoords);
            $submitted  = isset($submitResp['requests']);

            $finalStatus = 'draft';
            if ($submitted) {
                $finalStatus = $this->awaitSubmittedStatus($zohoRequestId);
            }

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
            $sigReq->signers           = $this->withPlacements($signers, (array) ($data['document_settings'] ?? []));
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

            $pdfEmailed   = false;
            $signerEmail  = (string) ($signers[0]['email'] ?? '');
            if ($signerEmail !== '') {
                try {
                    $emailKind     = $docKind === 'quotation' ? 'Quotation' : 'Proforma Invoice';
                    $safeCode      = preg_replace('/[^A-Za-z0-9_-]/', '_', (string) ($record->code ?: ('id-' . $record->id)));
                    $emailFilename = "{$shortLabel}-{$safeCode}_signed.pdf";
                    app(SalesPdfController::class)->buildAndSendSalesDocEmail(
                        $record,
                        $emailKind,
                        $shortLabel,
                        $signerEmail,
                        $tempPath,
                        $emailFilename
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
            return response()->json(['status' => false, 'message' => $this->cleanSendError($e, 'Failed to send document for signature')], 500);
        } finally {
            @unlink($tempPath);
        }
    }

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

    private function partyLabel(?string $csv): string
    {
        return collect(explode(',', (string) $csv))
            ->map(fn($t) => trim($t))
            ->filter()
            ->map(fn($t) => strcasecmp($t, 'Buyer') === 0 ? 'Customer' : $t)
            ->unique()
            ->sortBy(fn($t) => [$t === 'Customer' ? 0 : ($t === 'Consignee' ? 1 : 2), $t])
            ->implode(', ');
    }

    private function leadConsigneeIsCustomer(?Lead $lead, $user): bool
    {
        if (!$lead || !$lead->consignee_id || !$lead->customer_id) return false;
        $consignee = Consignee::query()->forUser($user)->find($lead->consignee_id);
        return $consignee
            && $consignee->same_as_customer
            && (int) $consignee->customer_id === (int) $lead->customer_id;
    }

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

        $allParties = array_filter([
            'Customer'  => $customer,
            'Consignee' => $consignee,
        ]);

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
        ?Lead $lead = null,
    ) {
        $sourceHtml    = $contentOverride !== null ? $contentOverride : (string) $agreement->content;
        $sourceHtml    = $this->hideOtherPartyTokens($sourceHtml, $agreement->party ?? null);
        $processedHtml = $this->replacePlaceholders($sourceHtml, $party, $modelName, $allParties);
        $processedHtml = $this->expandProductTable($processedHtml, $lead);
        $processedHtml = PdfHtml::repairTableMarkup($processedHtml);
        $client        = Client::find($agreement->client_id);

        $savedHeader = is_array($agreement->header_config) ? $agreement->header_config : [];
        $savedFooter = is_array($agreement->footer_config) ? $agreement->footer_config : [];
        $headerConfig = is_array($headerOverride) ? array_replace($savedHeader, $headerOverride) : $savedHeader;
        $footerConfig = is_array($footerOverride) ? array_replace($savedFooter, $footerOverride) : $savedFooter;

        $headerLogoBase64 = $this->resolveLogoBase64(
            $headerConfig['logo_path'] ?? null,
            $this->pathFromStorageUrl($headerConfig['logo_url'] ?? null),
            $client?->logo,
        );

        $cacheKey = 'clm:agrpdf:' . sha1(implode('|', [
            (int) $agreement->client_id,
            (int) $agreement->id,
            (string) $agreement->updated_at,
            md5($processedHtml),
            md5((string) json_encode($headerConfig)),
            md5((string) json_encode($footerConfig)),
            md5((string) $headerLogoBase64),
            md5((string) json_encode($signers ?? [])),
            $modelName,
            (string) ($party->id ?? ''),
            (string) ($party->updated_at ?? ''),
            (string) ($client->updated_at ?? ''),
        ]));

        try {
            if ($hit = Cache::get($cacheKey)) {
                return base64_decode($hit);
            }
        } catch (\Throwable $e) {
        }

        $bytes = Pdf::loadView('pdf.clm-signature-document', [
            'document'         => $agreement,
            'party'            => $party,
            'modelName'        => $modelName,
            'processedHtml'    => $processedHtml,
            'generatedDate'    => now()->format('d/m/Y'),
            'requestId'        => substr($requestUuid, 0, 8),
            'signers'          => $signers ?? [],
            'client'           => $client,
            'headerConfig'     => $headerConfig,
            'pageConfig'       => [],
            'footerConfig'     => $footerConfig,
            'headerLogoBase64' => $headerLogoBase64,
        ])
            ->setPaper('a4')
            ->setOption('isPhpEnabled', true)
            ->output();

        if (strlen($bytes) <= 5 * 1024 * 1024) {
            try {
                Cache::put($cacheKey, base64_encode($bytes), now()->addMinutes(30));
            } catch (\Throwable $e) {
            }
        }

        return $bytes;
    }

    public function index(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);

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

        $q = ClmSignatureRequest::query()
            ->forUser($user, $request->integer('branch_id') ?: null)
            ->latest();

        if ($filterPartyId)   $q->where('party_id', $filterPartyId);
        if ($filterModelName) $q->where('model_name', $filterModelName);
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

        if ($request->boolean('sync') && $this->zoho->isConfigured()) {
            $changed = false;

            $syncable = $rows->filter(function (ClmSignatureRequest $row) {
                if (!$row->zoho_request_id) return false;
                return $row->status === 'inprogress'
                    || ($row->status === 'completed' && empty($row->signed_document_paths));
            });
            $batch = $syncable->isEmpty()
                ? []
                : $this->zoho->getRequestsBatch($syncable->pluck('zoho_request_id')->all());

            foreach ($rows as $row) {
                if (!$row->zoho_request_id) continue;

                $isInProgress      = $row->status === 'inprogress';
                $isCompletedNoFile = $row->status === 'completed'
                    && empty($row->signed_document_paths);
                if (!$isInProgress && !$isCompletedNoFile) continue;

                try {
                    $key = (string) $row->zoho_request_id;
                    if (array_key_exists($key, $batch) && $batch[$key] === null) continue;
                    $details = $batch[$key] ?? $this->zoho->getRequest($row->zoho_request_id);
                    if ($this->syncSignerActivity($row, $details)) $changed = true;
                    $newStatus = strtolower((string) data_get($details, 'requests.request_status', $row->status));
                    if ($newStatus !== $row->status) {
                        $row->status = $newStatus;
                        if ($newStatus === 'completed' && !$row->completed_at) {
                            $row->completed_at = now();
                        }
                        $row->save();
                        $changed = true;
                    }
                    if (in_array($newStatus, ['declined', 'rejected', 'recalled'], true)) {
                        if ($this->stampDeclineFromZoho($row, $details)) $changed = true;
                    }
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

        $rows->transform(function (ClmSignatureRequest $row) {
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

            if (empty($resolvedMulti) && $row->status === 'completed') {
                $fromDisk = $this->adoptSignedDocsFromDisk($row);
                if (!empty($fromDisk)) $resolvedMulti = $fromDisk;
            }

            $firstSignedFromDisk = $resolvedMulti[0]['file_url'] ?? null;
            $signedUrl = file_url($row->signed_document_path) ?: $firstSignedFromDisk;
            $row->setAttribute('signed_document_url',  $signedUrl);
            $row->setAttribute('certificate_url',      file_url($row->certificate_path));
            $row->setAttribute('signed_document_paths', $resolvedMulti);
            $row->setAttribute('file_url', $signedUrl);
            return $row;
        });

        return response()->json(['status' => true, 'data' => $rows, 'count' => $rows->count()]);
    }

    public function show(Request $request, $id)
    {
        $user = $request->user();
        if (!$user) abort(401);
        $row  = ClmSignatureRequest::query()->forUser($user)->findOrFail($id);

        $perSigner = [];
        $pickTimeMs = function (array $a, array $keys): ?string {
            foreach ($keys as $k) {
                $v = $a[$k] ?? null;
                if (is_numeric($v) && (int) $v > 0) {
                    return \Illuminate\Support\Carbon::createFromTimestampMs((int) $v)->toIso8601String();
                }
            }
            return null;
        };

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

            $this->syncSignerActivity($row, $details);

            if (in_array($zohoState, ['declined', 'rejected', 'recalled'], true)) {
                $this->stampDeclineFromZoho($row, $details);
            }

            foreach (data_get($details, 'requests.actions', []) as $a) {
                $email = strtolower((string) ($a['recipient_email'] ?? ''));
                if ($email === '') continue;
                $perSigner[$email] = [
                    'raw'       => strtolower((string) ($a['action_status'] ?? '')),
                    'signed_at' => $pickTimeMs((array) $a, ['signed_time']),
                    'viewed_at' => $pickTimeMs((array) $a, ['viewed_time', 'delivered_time', 'verify_time']),
                ];
            }
        } catch (\Throwable $e) {
            Log::warning('Zoho status sync failed: ' . $e->getMessage());
        }

        $fresh   = $row->fresh();
        $overall = strtolower((string) $fresh->status);
        $normalize = function (string $raw) use ($overall): string {
            if (in_array($raw, ['signed', 'completed', 'approved'], true))  return 'signed';
            if ($this->isUndeliveredStatus($raw))                           return 'undelivered';
            if (in_array($raw, ['declined', 'rejected', 'recalled'], true)) return 'declined';
            if ($raw === 'viewed')                                          return 'viewed';
            if ($overall === 'completed') return 'signed';
            return 'pending';
        };

        $signersOut = collect($fresh->signers ?? [])->map(function ($s) use ($perSigner, $normalize, $fresh) {
            $s     = (array) $s;
            $email = strtolower((string) ($s['email'] ?? ''));
            $info  = $perSigner[$email] ?? ['raw' => '', 'signed_at' => null, 'viewed_at' => null];

            $storedViewed = $s['viewed_at'] ?? null;
            $storedSigned = $s['signed_at'] ?? null;

            $raw    = $info['raw'] !== '' ? $info['raw'] : strtolower((string) ($s['action_status'] ?? ''));
            $status = $normalize($raw);

            $s['status']        = $status;
            $s['action_status'] = $raw;
            $s['signed_at'] = $storedSigned
                ?: ($info['signed_at']
                    ?? ($status === 'signed' ? optional($fresh->completed_at)->toIso8601String() : null));
            $s['viewed_at'] = $status === 'undelivered' ? null : ($storedViewed ?: $info['viewed_at']);

            $s['delivery_failed']    = $status === 'undelivered';
            $s['delivery_failed_at'] = $s['delivery_failed']
                ? ($s['delivery_failed_at'] ?? optional($fresh->updated_at)->toIso8601String())
                : null;
            return $s;
        })->values()->all();

        $payload = $fresh->toArray();
        $payload['signers'] = $signersOut;

        $undeliveredTo = collect($signersOut)
            ->filter(fn($s) => !empty($s['delivery_failed']))
            ->map(fn($s) => (string) ($s['name'] ?: $s['email'] ?: 'signer'))
            ->values()->all();
        $payload['delivery_failed']         = count($undeliveredTo) > 0;
        $payload['undelivered_recipients']  = $undeliveredTo;

        $payload['attempts'] = [];
        if ($fresh->trade_doc_id) {
            try {
                $sibs = ClmSignatureRequest::query()->forUser($user)
                    ->where('document_type', $fresh->document_type)
                    ->where('model_name', $fresh->model_name)
                    ->where('party_id', $fresh->party_id)
                    ->where('trade_doc_id', $fresh->trade_doc_id)
                    ->orderBy('created_at')
                    ->get(['id', 'status', 'created_at', 'declined_at', 'decline_reason', 'recalled_at', 'recall_reason', 'completed_at', 'reminder_count', 'signers']);
                $payload['attempts'] = $sibs->map(function ($r) {
                    $viewed = collect(is_array($r->signers) ? $r->signers : [])
                        ->pluck('viewed_at')->filter()->sort()->first();
                    return [
                        'id'             => $r->id,
                        'status'         => $r->status,
                        'delivery_failed' => $this->rowHasDeliveryFailure($r),
                        'created_at'     => optional($r->created_at)->toIso8601String(),
                        'viewed_at'      => $viewed ?: null,
                        'declined_at'    => optional($r->declined_at)->toIso8601String(),
                        'decline_reason' => $r->decline_reason,
                        'recalled_at'    => optional($r->recalled_at)->toIso8601String(),
                        'recall_reason'  => $r->recall_reason,
                        'completed_at'   => optional($r->completed_at)->toIso8601String(),
                    ];
                })->all();
            } catch (\Throwable $e) {
                Log::warning('Attempt-trail lookup failed for sig ' . $fresh->id . ': ' . $e->getMessage());
            }
        }

        return response()->json([
            'status' => true,
            'data'   => $payload,
        ]);
    }

    private function stampDeclineFromZoho(ClmSignatureRequest $row, array $details): bool
    {
        $reqStatus = strtolower((string) data_get($details, 'requests.request_status', ''));

        $pickReason = function (array $a): string {
            foreach (['reason', 'reject_reason', 'rejection_reason', 'decline_reason', 'declined_reason', 'recipient_comment', 'comments', 'comment', 'action_comment'] as $k) {
                if (!empty($a[$k])) return (string) $a[$k];
            }
            return '';
        };
        $reqLevelReason = '';
        foreach (['reason', 'reject_reason', 'declined_reason', 'decline_reason'] as $k) {
            $rv = data_get($details, "requests.$k");
            if (!empty($rv)) {
                $reqLevelReason = (string) $rv;
                break;
            }
        }

        $reasonByEmail  = [];
        $declinedReason = '';
        foreach (data_get($details, 'requests.actions', []) as $a) {
            $st = strtolower((string) ($a['action_status'] ?? ''));
            if (!in_array($st, ['declined', 'rejected'], true)) continue;
            $email  = strtolower((string) ($a['recipient_email'] ?? ''));
            $reason = $pickReason((array) $a) ?: $reqLevelReason;
            if ($email !== '') $reasonByEmail[$email] = $reason;
            if ($declinedReason === '' && $reason !== '') $declinedReason = $reason;
        }

        $isRecalled = $reqStatus === 'recalled';
        $isDeclined = in_array($reqStatus, ['declined', 'rejected'], true)
            || (!$isRecalled && !empty($reasonByEmail));
        if (!$isDeclined && !$isRecalled) return false;

        $actionMs = (int) (data_get($details, 'requests.action_time') ?: 0);
        if ($actionMs <= 0) {
            foreach (data_get($details, 'requests.actions', []) as $a) {
                if (!in_array(strtolower((string) ($a['action_status'] ?? '')), ['declined', 'rejected', 'recalled'], true)) continue;
                foreach (['action_time', 'declined_time', 'rejected_time', 'recall_time'] as $tk) {
                    if (is_numeric($a[$tk] ?? null) && (int) $a[$tk] > 0) {
                        $actionMs = (int) $a[$tk];
                        break 2;
                    }
                }
            }
        }
        $eventAt = $actionMs > 0 ? \Illuminate\Support\Carbon::createFromTimestampMs($actionMs) : now();

        $reason  = $declinedReason ?: $reqLevelReason;
        $changed = false;

        if ($isRecalled) {
            if (!$row->recalled_at) {
                $row->recalled_at = $eventAt;
                $changed = true;
            }
            if ($reason !== '' && $row->recall_reason !== $reason) {
                $row->recall_reason = $reason;
                $changed = true;
            }
        } else {
            $firstSighting = !$row->declined_at;
            if ($firstSighting) {
                $row->declined_at = $eventAt;
                $changed = true;
            }
            if ($reason !== '' && $row->decline_reason !== $reason) {
                $row->decline_reason = $reason;
                $changed = true;
            }
            if ($firstSighting) {
                $this->voidSignatureRequest($row, $reason !== '' ? $reason : 'Declined by a signer');
                $changed = true;
            }
        }

        if (!empty($reasonByEmail) && is_array($row->signers)) {
            $signers = $row->signers;
            $touched = false;
            foreach ($signers as &$s) {
                if (!is_array($s)) continue;
                $email = strtolower((string) ($s['email'] ?? ''));
                if (!array_key_exists($email, $reasonByEmail)) continue;
                $s['status']        = 'declined';
                $s['action_status'] = 'declined';
                if ($reasonByEmail[$email] !== '') $s['decline_reason'] = $reasonByEmail[$email];
                $touched = true;
            }
            unset($s);
            if ($touched) {
                $row->signers = $signers;
                $changed = true;
            }
        }

        if ($changed) $row->save();
        return $changed;
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
            $msg = $e->getMessage();
            if (str_contains($msg, '4066') || stripos($msg, 'Invalid Request ID') !== false) {
                $row->status      = 'recalled';
                $row->recalled_at = now();
                $row->save();
                return response()->json([
                    'status'  => false,
                    'message' => 'This signing request no longer exists in Zoho Sign (it may have been created under a different Zoho account or removed). It has been reset — please send the document for signature again.',
                ], 409);
            }
            return response()->json(['status' => false, 'message' => 'Failed to send reminder: ' . $msg], 500);
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

    public function declinedFile(Request $request, $id)
    {
        $user = $request->user();
        if (!$user) abort(401);
        $row  = ClmSignatureRequest::query()->forUser($user)->findOrFail($id);

        if (!in_array(strtolower((string) $row->status), ['declined', 'rejected', 'recalled'], true)) {
            return response()->json(['status' => false, 'message' => 'This document was not declined.'], 404);
        }
        if (!$row->zoho_request_id) {
            return response()->json(['status' => false, 'message' => 'The declined document is not available.'], 404);
        }

        $slug = fn($s) => trim(preg_replace('/_+/', '_', preg_replace('/[^A-Za-z0-9]+/', '_', (string) $s)), '_');
        $party    = $row->party;
        $customer = (string) (data_get($party, 'company_name') ?: data_get($party, 'name') ?: '');
        $codeBase = (string) ($row->request_name ?: ($row->document_type . '-' . ($row->trade_doc_id ?: $row->id)));
        $fileBase = $slug($codeBase) . ($customer ? '_' . $slug($customer) : '') . '_declined';
        $storePath = 'signed_documents/declined/' . $row->id . '_' . $fileBase . '.pdf';

        if (!Storage::disk('public')->exists($storePath)) {
            try {
                $docIds  = is_array($row->zoho_document_ids) ? $row->zoho_document_ids : [];
                $firstDoc = null;
                foreach ($docIds as $d) {
                    $firstDoc = is_array($d) ? ($d['document_id'] ?? null) : $d;
                    if ($firstDoc) break;
                }
                $pdf = $firstDoc
                    ? $this->zoho->downloadDocumentPdf($row->zoho_request_id, (string) $firstDoc)
                    : $this->zoho->downloadRequestPdf($row->zoho_request_id);

                if (substr($pdf, 0, 4) !== '%PDF') {
                    throw new RuntimeException('Zoho did not return a valid PDF for the declined document.');
                }
                Storage::disk('public')->put($storePath, $pdf);
            } catch (\Throwable $e) {
                Log::warning("Declined document fetch failed for sig {$row->id}: " . $e->getMessage());
                return response()->json(['status' => false, 'message' => 'Could not fetch the declined document from Zoho.'], 502);
            }
        }

        return response(Storage::disk('public')->get($storePath), 200, [
            'Content-Type'        => 'application/pdf',
            'Content-Disposition' => 'attachment; filename="' . basename($storePath) . '"',
        ]);
    }

    private function zohoRequestShape($createResp, string $zohoRequestId): array
    {
        $actions = data_get($createResp, 'requests.actions',      []);
        $docIds  = data_get($createResp, 'requests.document_ids', []);
        if (!empty($actions) && !empty($docIds)) {
            return [$actions, $docIds];
        }

        $details = $this->zoho->getRequest($zohoRequestId);
        return [
            data_get($details, 'requests.actions',      []),
            data_get($details, 'requests.document_ids', []),
        ];
    }
    private function awaitSubmittedStatus(string $zohoRequestId): string
    {
        $deadline = microtime(true) + 1.0;
        $status   = 'draft';
        do {
            try {
                $after  = $this->zoho->getRequest($zohoRequestId);
                $status = strtolower((string) data_get($after, 'requests.request_status', 'inprogress'));
            } catch (\Throwable $e) {
                Log::warning('Zoho post-submit status fetch failed: ' . $e->getMessage());
                return 'inprogress';
            }
            if ($status !== 'draft') return $status;
            usleep(200_000);
        } while (microtime(true) < $deadline);

        return $status;
    }
    private function renderPdf(
        ClmTradeDocLibrary|ClmAgreementLibrary $doc,
        Model $party,
        string $modelName,
        string $requestUuid,
        ?array $signers = null,
        ?array $headerOverride = null,
        ?array $footerOverride = null,
        ?string $contentOverride = null,
        ?Lead $lead = null,
    ) {
        @ini_set('memory_limit', '1024M');
        @set_time_limit(180);

        $sourceHtml    = $contentOverride !== null ? $contentOverride : (string) $doc->content;
        $sourceHtml    = $this->hideOtherPartyTokens($sourceHtml, $doc->party ?? null);
        $allParties = [];
        if ($lead) {
            $cust = $lead->customer_id  ? Customer::where('client_id', $doc->client_id)->find($lead->customer_id)   : null;
            $cons = $lead->consignee_id ? Consignee::where('client_id', $doc->client_id)->find($lead->consignee_id) : null;
            if ($cust) $allParties['Customer'] = $cust;
            if ($cons) $allParties['Consignee'] = $cons;
        }
        $processedHtml = $this->replacePlaceholders($sourceHtml, $party, $modelName, $allParties);
        $processedHtml = $this->expandProductTable($processedHtml, $lead);
        $processedHtml = PdfHtml::repairTableMarkup($processedHtml);
        $client = Client::find($doc->client_id);

        $headerConfig = is_array($headerOverride) ? $headerOverride
            : (is_array($doc->header_config) ? $doc->header_config : []);
        $footerConfig = is_array($footerOverride) ? $footerOverride
            : (is_array($doc->footer_config) ? $doc->footer_config : []);

        $headerLogoBase64 = $this->resolveLogoBase64(
            $headerConfig['logo_path'] ?? null,
            $this->pathFromStorageUrl($headerConfig['logo_url'] ?? null),
            $client?->logo,
        );

        $cacheKey = 'clm:tdpdf:' . sha1(implode('|', [
            (int) $doc->client_id,
            (int) $doc->id,
            (string) $doc->updated_at,
            md5($processedHtml),
            md5((string) json_encode($headerConfig)),
            md5((string) json_encode($footerConfig)),
            md5((string) $headerLogoBase64),
            md5((string) json_encode($signers ?? [])),
            $modelName,
            (string) ($party->id ?? ''),
            (string) ($party->updated_at ?? ''),
            (string) ($client->updated_at ?? ''),
        ]));

        try {
            if ($hit = Cache::get($cacheKey)) {
                return base64_decode($hit);
            }
        } catch (\Throwable $e) {
        }

        $bytes = Pdf::loadView('pdf.clm-signature-document', [
            'document'         => $doc,
            'party'            => $party,
            'modelName'        => $modelName,
            'processedHtml'    => $processedHtml,
            'generatedDate'    => now()->format('d/m/Y'),
            'requestId'        => substr($requestUuid, 0, 8),
            'signers'          => $signers ?? [],
            'client'           => $client,
            'headerConfig'     => $headerConfig,
            'pageConfig'       => [],
            'footerConfig'     => $footerConfig,
            'headerLogoBase64' => $headerLogoBase64,
        ])
            ->setPaper('a4')
            ->setOption('isPhpEnabled', true)
            ->output();

        if (strlen($bytes) <= 5 * 1024 * 1024) {
            try {
                Cache::put($cacheKey, base64_encode($bytes), now()->addMinutes(30));
            } catch (\Throwable $e) {
            }
        }

        return $bytes;
    }

    private function resolveLogoBase64(?string ...$candidates): string
    {
        $disk = \Illuminate\Support\Facades\Storage::disk('public');
        foreach ($candidates as $path) {
            if (!$path) continue;
            try {
                if (!$disk->exists($path)) continue;

                $stamp    = (string) ($disk->lastModified($path) ?: 0);
                $cacheKey = 'clm_sig_logo_b64:' . md5($path . '|' . $stamp);

                return \Illuminate\Support\Facades\Cache::remember(
                    $cacheKey,
                    now()->addDay(),
                    function () use ($disk, $path) {
                        $bytes = $disk->get($path);
                        $flat = $this->flattenImageForPdf($bytes);
                        return base64_encode($flat ?? $bytes);
                    }
                );
            } catch (\Throwable $e) {
            }
        }
        return '';
    }

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

    private function pathFromStorageUrl(?string $url): ?string
    {
        if (!$url) return null;
        if (preg_match('#/storage/(.+)$#', $url, $m)) {
            return $m[1];
        }
        return null;
    }

    private function hideOtherPartyTokens(string $html, ?string $applicableParty): string
    {
        $p = strtolower(trim((string) $applicableParty));
        if ($p === '' || $html === '') return $html;
        $html = str_replace(
            ['&#123;', '&#x7B;', '&#125;', '&#x7D;', '&lcub;', '&rcub;'],
            ['{',      '{',      '}',      '}',      '{',      '}'],
            $html,
        );
        $drop = str_contains($p, 'supplier') ? ['customer', 'consignee', 'buyer'] : ['supplier'];
        foreach ($drop as $ns) {
            $html = preg_replace('/\{\{\s*' . $ns . '\s*\.[^{}]*\}\}/iu', '', $html);
        }
        return $html;
    }

    private function replacePlaceholders(string $html, Model $party, string $modelName, array $extraParties = []): string
    {
        if ($html === '') return '<p></p>';

        $html = $this->replacePartyNamespaceTokens($html, $party, $modelName);
        foreach ($extraParties as $extraModelName => $extraParty) {
            if (!$extraParty) continue;
            if ($extraModelName === $modelName) continue;
            $html = $this->replacePartyNamespaceTokens($html, $extraParty, $extraModelName);
        }

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

        $html = $this->replaceOrgBranchTokens($html);

        return $html;
    }

    private function replaceOrgBranchTokens(string $html): string
    {
        if (strpos($html, '{{') === false) return $html;

        $user   = request()->user();
        $branch = $user && $user->branch_id ? Branch::find($user->branch_id) : null;

        $address = $branch ? trim(implode(', ', array_filter([
            trim((string) $branch->address),
            trim((string) $branch->city),
            trim((string) $branch->state),
            trim(trim((string) $branch->pincode) . ' ' . trim((string) $branch->country)),
        ], fn($v) => $v !== '')), ', ') : '';

        $values = [
            'company_name' => e((string) ($branch->name  ?? '')),
            'company_no'   => e((string) ($branch->cin   ?? '')),
            'email'        => e((string) ($branch->email ?? '')),
            'contact_no'   => e((string) ($branch->phone ?? '')),
            'address'      => e($address),
        ];
        foreach ($values as $token => $value) {
            $html = preg_replace('/\{\{\s*' . $token . '\s*\}\}/iu', $value, $html);
        }

        $sig = $this->branchSignatureDataUri($branch);
        $sigHtml = $sig
            ? '<img src="' . $sig . '" alt="Authorised Signatory" style="display:block;max-height:80px;max-width:210px;object-fit:contain;margin:8px 0 6px;" />'
            : '';
        return preg_replace('/\{\{\s*signature\s*\}\}/iu', $sigHtml, $html);
    }

    private function branchSignatureDataUri(?Branch $branch): ?string
    {
        $path = $branch?->signature_path;
        if (!$path) return null;
        if (preg_match('#/storage/(.+)$#', (string) $path, $m)) $path = $m[1];
        try {
            if (!Storage::disk('public')->exists($path)) return null;
            $data = base64_encode(Storage::disk('public')->get($path));
            $ext  = strtolower(pathinfo($path, PATHINFO_EXTENSION) ?: 'png');
            $mime = in_array($ext, ['jpg', 'jpeg']) ? 'image/jpeg' : ($ext === 'webp' ? 'image/webp' : 'image/png');
            return "data:$mime;base64,$data";
        } catch (\Throwable $e) {
            return null;
        }
    }

    private function expandProductTable(string $html, ?Lead $lead): string
    {
        if (strpos($html, '{{product.') === false) return $html;

        $html = str_replace(
            ['&#123;', '&#x7B;', '&#125;', '&#x7D;', '&lcub;', '&rcub;'],
            ['{',      '{',      '}',      '}',      '{',      '}'],
            $html,
        );

        $products = $lead
            ? LeadProduct::with([
                'product:id,product_code,name,segment_id,description,haz_type,hsn_id',
                'product.segment:id,name',
                'product.hsn:id,hsn_code',
            ])
            ->where('lead_id', $lead->id)
            ->orderBy('id')
            ->get()
            : collect();

        if (!preg_match('/<tr\b[^>]*>(?:(?!<\/tr>).)*?\{\{product\.[^}]*\}\}(?:(?!<\/tr>).)*?<\/tr>/is', $html, $m)) {
            return $this->fillProductTokens($html, $products->first(), 1);
        }
        $templateRow = $m[0];

        if ($products->isEmpty()) {
            $rows = $this->fillProductTokens($templateRow, null, 1);
        } else {
            $rows = '';
            $i = 1;
            foreach ($products as $p) {
                $rows .= $this->fillProductTokens($templateRow, $p, $i++);
            }
        }

        $pos = strpos($html, $templateRow);
        return substr_replace($html, $rows, $pos, strlen($templateRow));
    }

    private function fillProductTokens(string $snippet, ?LeadProduct $p, int $sr): string
    {
        return strtr($snippet, [
            '{{product.sr}}'          => (string) $sr,
            '{{product.code}}'        => e($p?->product?->product_code ?? ''),
            '{{product.name}}'        => e($p?->product?->name ?? ''),
            '{{product.segment}}'     => e($p?->product?->segment?->name ?? ''),
            '{{product.quantity}}'    => e((string) ($p?->quantity ?? '')),
            '{{product.hsn_sac}}'     => e($p?->product?->hsn?->hsn_code ?? ''),
            '{{product.description}}' => e($p?->product?->description ?? ''),
            '{{product.haz}}'         => e($p?->product?->haz_type ?? ''),
        ]);
    }

    public static function replacePartyNamespaceTokens(string $html, Model $party, string $modelName): string
    {
        $partyToTokenNamespaces = [
            'Customer'  => ['customer', 'buyer'],
            'Consignee' => ['consignee'],
            'Vendor'    => ['supplier'],
        ];
        $namespaces = $partyToTokenNamespaces[$modelName] ?? null;
        if (empty($namespaces)) return $html;

        $html = str_replace(
            ['&#123;', '&#x7B;', '&#125;', '&#x7D;', '&lcub;', '&rcub;'],
            ['{',      '{',       '}',      '}',      '{',      '}'],
            $html,
        );

        $addr = $party->primaryAddress ?? $party->addresses()->first();

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

        $nameValue   = e($party->company_name ?? '');
        $codeValue   = e($party->{$codeAttr} ?? '');
        $cityValue   = e($scalar($addr?->city ?? null));

        $values = [
            'name'            => $nameValue,
            'code'            => $codeValue,
            'buyer_name'      => $nameValue,
            'consignee_name'  => $nameValue,
            'supplier_name'   => $nameValue,
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
            'zip_code'        => e($pinStr),
            'delivery_address' => e($addressLine),
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

        foreach ($namespaces as $ns) {
            $leftover = '/\{\{\s*'
                . preg_quote($ns, '/')
                . '\s*\.\s*(?!signature\s*\}\})[^{}]*\}\}/iu';
            $html = preg_replace($leftover, '', $html);
        }

        return $html;
    }

    public static function sigMarkerToken(string $party): string
    {
        return '«CBC-SIG-' . strtoupper($party) . '-9417»';
    }

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

    private const UNDELIVERED_ACTION_STATUSES = [
        'UNDELIVERED',
        'NOTDELIVERED',
        'NOT_DELIVERED',
        'DELIVERYFAILED',
        'DELIVERY_FAILED',
        'BOUNCED',
        'MAILBOUNCED',
        'MAIL_BOUNCED',
        'EMAILBOUNCED',
        'EMAIL_BOUNCED',
    ];

    private function isUndeliveredStatus(?string $raw): bool
    {
        $s = strtoupper(trim((string) $raw));
        if ($s === '') return false;
        return in_array($s, self::UNDELIVERED_ACTION_STATUSES, true);
    }

    private function rowHasDeliveryFailure(ClmSignatureRequest $row): bool
    {
        foreach ((array) ($row->signers ?? []) as $sg) {
            $sg = (array) $sg;
            if (!empty($sg['delivery_failed_at'])) return true;
            if ($this->isUndeliveredStatus($sg['action_status'] ?? null)) return true;
        }
        return false;
    }

    private function syncSignerActivity(ClmSignatureRequest $row, array $details): bool
    {
        $actions = data_get($details, 'requests.actions', []);
        if (!is_array($actions) || empty($actions)) return false;

        $actionMs = (int) (data_get($details, 'requests.action_time')
            ?: data_get($details, 'requests.modified_time') ?: 0);
        $stamp = $actionMs > 0
            ? \Illuminate\Support\Carbon::createFromTimestampMs($actionMs)->toIso8601String()
            : now()->toIso8601String();

        $statusByEmail = [];
        foreach ($actions as $a) {
            $email = strtolower(trim((string) ($a['recipient_email'] ?? '')));
            if ($email !== '') $statusByEmail[$email] = strtoupper((string) ($a['action_status'] ?? ''));
        }

        $signers = is_array($row->signers) ? $row->signers : [];
        $changed = false;
        foreach ($signers as $i => $sg) {
            $email = strtolower(trim((string) ($sg['email'] ?? '')));
            if ($email === '' || !array_key_exists($email, $statusByEmail)) continue;
            $st = $statusByEmail[$email];

            $undelivered = $this->isUndeliveredStatus($st);
            $opened = $st !== ''
                && !in_array($st, ['UNOPENED', 'NOTVIEWED', 'UNRECEIVED'], true)
                && !$undelivered;
            $signed = $st === 'SIGNED';

            if (($signers[$i]['action_status'] ?? null) !== $st) {
                $signers[$i]['action_status'] = $st;
                $changed = true;
            }
            if ($opened && empty($signers[$i]['viewed_at'])) {
                $signers[$i]['viewed_at'] = $stamp;
                $changed = true;
            }
            if ($signed && empty($signers[$i]['signed_at'])) {
                $signers[$i]['signed_at'] = $stamp;
                $changed = true;
            }

            if ($undelivered && empty($signers[$i]['delivery_failed_at'])) {
                $signers[$i]['delivery_failed_at'] = $stamp;
                $changed = true;
            } elseif (!$undelivered && !empty($signers[$i]['delivery_failed_at'])) {
                $signers[$i]['delivery_failed_at'] = null;
                $changed = true;
            }
        }

        if ($changed) {
            $row->signers = $signers;
            $row->save();
        }
        return $changed;
    }

    private function fetchSignedArtifacts(ClmSignatureRequest $row, array $details): void
    {
        $modelFolder = strtolower($row->model_name);
        $basePath    = 'uploads/signed_documents/' . $modelFolder;
        $diskName    = config('filesystems.disks.public.driver');
        $logCtx      = ['row_id' => $row->id, 'zoho_request_id' => $row->zoho_request_id, 'disk' => $diskName];

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
                $bytes = $this->zoho->downloadDocumentPdf($row->zoho_request_id, $zohoId);
                if (!is_string($bytes) || $bytes === '') {
                    throw new RuntimeException('Zoho returned empty bytes');
                }

                $safe     = Str::slug(pathinfo((string) $name, PATHINFO_FILENAME)) ?: ('document_' . ($i + 1));
                $fileName = sprintf('signed_%s_%d_%d.pdf', $safe, time(), $i);
                $path     = $basePath . '/' . $fileName;
                $ok       = Storage::disk('public')->put($path, $bytes);
                if ($ok === false) {
                    throw new RuntimeException('Storage::put returned false (disk=' . $diskName . ')');
                }

                $publicUrl = file_url($path);
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
                Log::error('signed_doc fetch failed', $logCtx + [
                    'zoho_doc_id' => $zohoId,
                    'err'         => $e->getMessage(),
                    'class'       => get_class($e),
                ]);
            }
        }

        if (empty($savedPaths) && !empty($zohoIds)) {
            try {
                $bytes = $this->zoho->downloadRequestPdf($row->zoho_request_id);
                if (is_string($bytes) && $bytes !== '') {
                    $safe     = Str::slug($row->request_name) ?: 'request';
                    $fileName = sprintf('signed_%s_%d_0.pdf', $safe, time());
                    $path     = $basePath . '/' . $fileName;
                    $ok       = Storage::disk('public')->put($path, $bytes);
                    if ($ok === false) {
                        throw new RuntimeException('Storage::put returned false (disk=' . $diskName . ')');
                    }
                    $publicUrl = file_url($path);
                    $savedPaths[] = [
                        'zoho_document_id' => $zohoIds[0] ?? null,
                        'document_name'    => $row->request_name,
                        'path'             => $path,
                        'url'              => $publicUrl,
                        'file_url'         => $publicUrl,
                        'size'             => strlen($bytes),
                    ];
                    Log::info('signed_doc saved via request-level fallback', $logCtx + ['path' => $path, 'size' => strlen($bytes)]);
                }
            } catch (\Throwable $e) {
                Log::error('signed_doc request-level fallback failed', $logCtx + ['err' => $e->getMessage(), 'class' => get_class($e)]);
            }
        }

        if (!empty($savedPaths)) {
            $row->zoho_document_ids      = $zohoIds;
            $row->signed_document_paths  = $savedPaths;
            $row->signed_document_path   = $savedPaths[0]['path'] ?? null;
        } else {
            Log::warning('signed_doc fetch produced no saved paths', $logCtx + ['expected_count' => count($zohoIds)]);
        }

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
