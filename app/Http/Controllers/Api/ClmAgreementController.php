<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Controllers\Concerns\HandlesDocxHtmlRoundtrip;
use App\Models\ClmAgreementLibrary;
use App\Models\ClmAgreementType;
use App\Models\ClmSegment;
use App\Models\ClmSignatureRequest;
use App\Models\Consignee;
use App\Models\Customer;
use App\Models\Lead;
use App\Models\ProformaInvoice;
use App\Models\Quotation;
use App\Models\Product;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use PhpOffice\PhpWord\IOFactory;
use PhpOffice\PhpWord\PhpWord;
use PhpOffice\PhpWord\Shared\Html;


class ClmAgreementController extends Controller
{
    use HandlesDocxHtmlRoundtrip;

    private const DOCX_MAX_KB = 20 * 1024;

    /* ── TYPES ── */

    public function typesIndex(Request $request)
    {
        $user = $request->user(); if (!$user) abort(401);
        $rows = $user->client_id
            ? ClmAgreementType::where('client_id', $user->client_id)->orderBy('id')->get()
            : collect();
        return response()->json(['status' => true, 'data' => $rows, 'count' => $rows->count()]);
    }

    public function typesStore(Request $request)
    {
        $user = $request->user(); if (!$user) abort(401);
        if (!$user->client_id) return response()->json(['status' => false, 'message' => 'No tenant context'], 403);

        $data = $request->validate([
            'name'        => 'required|string|max:255',
            'description' => 'required|string|max:500',
        ]);

        // Reject duplicate agreement-type names per client (case-insensitive).
        // Mirrors ClmSegmentController / ClmAuthorityController.
        $name = trim($data['name']);
        $exists = ClmAgreementType::where('client_id', $user->client_id)
            ->whereRaw('LOWER(name) = ?', [mb_strtolower($name)])
            ->exists();
        if ($exists) {
            return response()->json([
                'status'  => false,
                'message' => "An agreement type named \"{$name}\" already exists. Pick a different name.",
            ], 409);
        }

        $row = DB::transaction(function () use ($user, $data, $name) {
            DB::table('clients')->where('id', $user->client_id)->lockForUpdate()->first();
            $code = sprintf('AT-%03d', ClmAgreementType::where('client_id', $user->client_id)->count() + 1);
            return ClmAgreementType::create([
                'client_id'   => $user->client_id,
                'code'        => $code,
                'name'        => $name,
                'description' => trim($data['description']),
                'created_by'  => $user->id,
                'updated_by'  => $user->id,
            ]);
        });
        return response()->json(['status' => true, 'data' => $row], 201);
    }

    public function typesUpdate(Request $request, $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $row  = ClmAgreementType::where('client_id', $user->client_id)->findOrFail($id);
        $data = $request->validate([
            'name'        => 'sometimes|required|string|max:255',
            'description' => 'sometimes|required|string|max:500',
        ]);
        if (isset($data['name']))        $data['name']        = trim($data['name']);
        if (isset($data['description'])) $data['description'] = trim($data['description']);

        // Reject rename to a duplicate (case-insensitive, excluding self).
        if (isset($data['name'])) {
            $clash = ClmAgreementType::where('client_id', $user->client_id)
                ->where('id', '!=', $row->id)
                ->whereRaw('LOWER(name) = ?', [mb_strtolower($data['name'])])
                ->exists();
            if ($clash) {
                return response()->json([
                    'status'  => false,
                    'message' => "Another agreement type named \"{$data['name']}\" already exists. Pick a different name.",
                ], 409);
            }
        }

        $data['updated_by'] = $user->id;
        $row->update($data);
        return response()->json(['status' => true, 'data' => $row->fresh()]);
    }

    public function typesDestroy(Request $request, $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $row  = ClmAgreementType::where('client_id', $user->client_id)->findOrFail($id);

        // Block deletion while drafts in the Agreement Library still use this
        // type — the library references the type by name. The user must delete
        // those agreements first, then the type can be removed.
        $inUse = ClmAgreementLibrary::where('client_id', $user->client_id)
            ->whereRaw('LOWER(agreement_type) = ?', [mb_strtolower($row->name)])
            ->count();
        if ($inUse > 0) {
            return response()->json([
                'status'  => false,
                'message' => "This agreement type is used by {$inUse} agreement" . ($inUse === 1 ? '' : 's') . " in the Agreement Library. Delete " . ($inUse === 1 ? 'that agreement' : 'those agreements') . " first.",
            ], 409);
        }

        $row->delete();
        return response()->json(['status' => true, 'message' => 'Deleted']);
    }

    /* ── LIBRARY ── */

    public function libraryIndex(Request $request)
    {
        $user = $request->user(); if (!$user) abort(401);
        $rows = $user->client_id
            ? ClmAgreementLibrary::where('client_id', $user->client_id)->orderBy('id')->get()
            : collect();

        // Flag agreements that have a signed (completed) signature request so
        // the frontend can lock Edit / Delete on them. Batch lookup avoids an
        // N+1 of per-row existence checks.
        $signedIds = ClmSignatureRequest::signedDraftIds($user->client_id, ClmSignatureRequest::DOC_AGREEMENT);
        $rows->each(fn ($r) => $r->setAttribute('is_signed', in_array((int) $r->id, $signedIds, true)));

        return response()->json(['status' => true, 'data' => $rows, 'count' => $rows->count()]);
    }

    public function libraryStore(Request $request)
    {
        $user = $request->user(); if (!$user) abort(401);
        if (!$user->client_id) return response()->json(['status' => false, 'message' => 'No tenant context'], 403);

        $data = $request->validate([
            'agreement_type' => 'required|string|max:255',
            'title'          => 'required|string|max:255',
            'party'          => 'required|string|max:255',
            'regulatory'     => ['nullable', Rule::in(ClmAgreementLibrary::REG_VALUES)],
            'signing'        => 'nullable|boolean',
            'segment'        => 'nullable|string|max:1024',
            'agr_status'     => 'nullable|string|max:32',
            'content'        => 'nullable|string',
            'header_config'  => 'nullable|array',
            'footer_config'  => 'nullable|array',
        ]);

        $row = DB::transaction(function () use ($user, $data) {
            DB::table('clients')->where('id', $user->client_id)->lockForUpdate()->first();
            $code = sprintf('A-%03d', ClmAgreementLibrary::where('client_id', $user->client_id)->count() + 1);
            return ClmAgreementLibrary::create([
                'client_id'      => $user->client_id,
                'code'           => $code,
                'agreement_type' => trim($data['agreement_type']),
                'title'          => trim($data['title']),
                'party'          => trim($data['party']),
                'regulatory'     => $data['regulatory'] ?? ClmAgreementLibrary::REG_LESS,
                'signing'        => $data['signing']     ?? true,
                'segment'        => $data['segment']     ?? null,
                'agr_status'     => $data['agr_status']  ?? 'Active',
                'content'        => $data['content']     ?? null,
                'header_config'  => $data['header_config'] ?? null,
                'footer_config'  => $data['footer_config'] ?? null,
                'created_by'     => $user->id,
                'updated_by'     => $user->id,
            ]);
        });
        return response()->json(['status' => true, 'data' => $row], 201);
    }

    public function libraryUpdate(Request $request, $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $row  = ClmAgreementLibrary::where('client_id', $user->client_id)->findOrFail($id);

        // Lock once the agreement has been sent and signed. An agreement that
        // has come back signed via Zoho (a `completed` signature request) is a
        // legal record — editing it would silently diverge the master from the
        // copy the customer/consignee actually signed.
        if (ClmSignatureRequest::hasSignedDraft($user->client_id, (int) $row->id, ClmSignatureRequest::DOC_AGREEMENT)) {
            return response()->json([
                'status'  => false,
                'message' => 'This agreement has already been signed by the customer/consignee and can no longer be edited.',
            ], 422);
        }

        $data = $request->validate([
            'agreement_type' => 'sometimes|required|string|max:255',
            'title'          => 'sometimes|required|string|max:255',
            'party'          => 'sometimes|required|string|max:255',
            'regulatory'     => ['nullable', Rule::in(ClmAgreementLibrary::REG_VALUES)],
            'signing'        => 'nullable|boolean',
            'segment'        => 'nullable|string|max:1024',
            'agr_status'     => 'nullable|string|max:32',
            'content'        => 'nullable|string',
            'header_config'  => 'nullable|array',
            'footer_config'  => 'nullable|array',
        ]);
        $data['updated_by'] = $user->id;
        $row->update($data);
        return response()->json(['status' => true, 'data' => $row->fresh()]);
    }

    /**
     * Stage 2 page-shell logo upload for the agreement wizard. Mirrors
     * ClmTradeDocumentController::uploadHeaderLogo but stores under the
     * agreement_library/<client> folder so per-doc-type cleanup stays
     * straightforward. Returns { path, url } in the shape
     * [[HeaderFooterPanel]] expects.
     */
    public function uploadHeaderLogo(Request $request)
    {
        $user = $request->user(); if (!$user) abort(401);
        $request->validate(['logo' => 'required|file|mimes:png,jpg,jpeg,svg,webp|max:5120']);

        $clientSlug = $user->client_id ? 'c' . $user->client_id : 'public';
        $folder = "agreement_library/{$clientSlug}/logos";
        $file   = $request->file('logo');
        $ext    = strtolower($file->getClientOriginalExtension() ?: 'png');
        $filename = Str::random(16) . '.' . $ext;
        $path = $file->storeAs($folder, $filename, 'public');

        return response()->json([
            'path' => $path,
            'url'  => file_url($path),
        ]);
    }

    public function libraryDestroy(Request $request, $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $row  = ClmAgreementLibrary::where('client_id', $user->client_id)->findOrFail($id);

        // Same lock as libraryUpdate — a signed agreement must stay on record,
        // so block the delete once a `completed` signature request references
        // this draft.
        if (ClmSignatureRequest::hasSignedDraft($user->client_id, (int) $row->id, ClmSignatureRequest::DOC_AGREEMENT)) {
            return response()->json([
                'status'  => false,
                'message' => 'This agreement has already been signed by the customer/consignee and can no longer be deleted.',
            ], 422);
        }

        $row->delete();
        return response()->json(['status' => true, 'message' => 'Deleted']);
    }

    /* ── APPLICABLE AGREEMENTS FOR A LEAD ──
     *
     * GET /api/clm/leads/{leadId}/agreement-applicable
     *
     * Drives the Sales Matrix lead detail "Segment Details" card. Given a
     * lead, walks its latest non-cancelled Proforma Invoice → line-item
     * product IDs → product.segment_id → clm_segments. For each segment,
     * pulls the matching agreement-library rows (filtered by segment name
     * + regulatory tier), and returns everything grouped by regulatory
     * tier so the frontend can render High / Less popups directly.
     *
     * Also surfaces the existing clm_signature_requests for this lead so
     * each agreement row can show its current send status ('draft' if no
     * request yet, otherwise 'inprogress' / 'completed' / etc.).
     */
    public function applicableForLead(Request $request, $leadId)
    {
        $user = $request->user(); if (!$user) abort(401);

        $lead = Lead::where('client_id', $user->client_id)->findOrFail((int) $leadId);

        // Stage 5 = "Quotation vs PI". Stage 5 complete ⇒ lead has moved
        // to stage 6+ (Victory). The button on the Sales Matrix detail
        // card stays disabled until then.
        $stage5Complete = (int) ($lead->lead_stage_id ?? 1) >= 6;

        // Latest Proforma Invoice tied to this lead. Cancelled rows don't
        // count toward agreement-send eligibility — but draft/sent/etc do.
        $pi = ProformaInvoice::where('client_id', $user->client_id)
            ->where('opp_id', $lead->id)
            ->where('status', '!=', 'cancelled')
            ->orderByDesc('id')
            ->first();

        // Latest non-cancelled Quotation — Segment Details should populate
        // as soon as products are quoted, not only after PI conversion. The
        // PI is preferred when both exist; otherwise the quotation drives
        // the segment list.
        $quotation = Quotation::where('client_id', $user->client_id)
            ->where('opp_id', $lead->id)
            ->where('status', '!=', 'cancelled')
            ->orderByDesc('id')
            ->first();

        $source = $pi ?: $quotation;

        $sourceItems = $source
            ? $source->items()->whereNotNull('product_id')->get(['product_id'])
            : collect();
        $productIds = $sourceItems->pluck('product_id')->filter()->unique()->values();

        // Map products → segment_id. soft FK (no DB constraint per the
        // products migration comment), so we tolerate missing references.
        $segmentIds = Product::where('client_id', $user->client_id)
            ->whereIn('id', $productIds)
            ->whereNotNull('segment_id')
            ->pluck('segment_id')
            ->unique()
            ->values();

        $segments = ClmSegment::where('client_id', $user->client_id)
            ->whereIn('id', $segmentIds)
            ->orderBy('regulatory_status')
            ->orderBy('code')
            ->get();

        // Existing signature requests for this lead so the rows show live
        // status badges instead of always "Draft". Gated on `$pi` — when
        // no PI is mapped there are no segments to render either, so the
        // signature lookup would be wasted work.
        $sigRows = $source
            ? ClmSignatureRequest::where('client_id', $user->client_id)
                ->where('document_type', ClmSignatureRequest::DOC_AGREEMENT)
                ->where('lead_id', $lead->id)
                ->whereNull('deleted_at')
                ->orderByDesc('id')
                ->get()
            : collect();

        // Index sig requests by agreement-id so we can look up the most
        // recent send per agreement in O(1). Map "agreement_id => row".
        $latestPerAgreement = [];
        foreach ($sigRows as $r) {
            $ids = is_array($r->trade_doc_ids) ? $r->trade_doc_ids : [];
            foreach ($ids as $aid) {
                if (!isset($latestPerAgreement[$aid])) {
                    $latestPerAgreement[$aid] = $r;
                }
            }
        }

        // Build the per-segment agreement list.
        $segmentsOut = [];
        foreach ($segments as $seg) {
            // Less-reg agreements can be saved against multiple
            // segments (stored as a comma-separated string in the
            // `segment` column), so we LIKE-match the needle against
            // the CSV instead of doing an exact equality check. The
            // patterns wrap the needle in comma separators so
            // "Tobacco" can't accidentally match a row tagged
            // "Tobacco Stripping" while still hitting first/middle/
            // last/sole positions in the list.
            $name = $seg->name;
            $code = $seg->code;
            $agreements = ClmAgreementLibrary::where('client_id', $user->client_id)
                ->where('regulatory', $seg->regulatory_status)
                ->where(function ($q) use ($name, $code) {
                    foreach ([$name, $code] as $needle) {
                        $q->orWhere('segment', $needle)
                          ->orWhere('segment', 'LIKE', $needle . ',%')
                          ->orWhere('segment', 'LIKE', $needle . ', %')
                          ->orWhere('segment', 'LIKE', '%,' . $needle)
                          ->orWhere('segment', 'LIKE', '%, ' . $needle)
                          ->orWhere('segment', 'LIKE', '%,' . $needle . ',%')
                          ->orWhere('segment', 'LIKE', '%, ' . $needle . ',%');
                    }
                })
                ->where('agr_status', 'Active')
                ->orderBy('id')
                ->get();

            $agreementsOut = $agreements->map(function (ClmAgreementLibrary $a) use ($latestPerAgreement) {
                $req = $latestPerAgreement[$a->id] ?? null;
                $sigOut = null;
                if ($req) {
                    $signedPaths = is_array($req->signed_document_paths) ? $req->signed_document_paths : [];
                    $first = $signedPaths[0] ?? [];
                    $sigOut = [
                        'id'                    => $req->id,
                        'status'                => $req->status,
                        'sent_at'               => optional($req->created_at)->toIso8601String(),
                        'completed_at'          => optional($req->completed_at)->toIso8601String(),
                        'signed_url'            => $first['file_url'] ?? $first['url'] ?? null,
                        'certificate_url'       => $req->certificate_path ? file_url($req->certificate_path) : null,
                        // Reminder counter + last-sent timestamp drive
                        // the "Sent N times" badge on the Remind button.
                        'reminder_count'        => (int) ($req->reminder_count ?? 0),
                        'last_reminder_sent_at' => optional($req->last_reminder_sent_at)->toIso8601String(),
                    ];
                }
                return [
                    'id'             => $a->id,
                    'code'           => $a->code,
                    'title'          => $a->title,
                    'agreement_type' => $a->agreement_type,
                    'party'          => $a->party,
                    'regulatory'     => $a->regulatory,
                    'segment'        => $a->segment,
                    'required'       => $a->regulatory === 'highly' ? 'REQ' : 'OPT',
                    'updated_at'     => optional($a->updated_at)->toDateString(),
                    'signature_request' => $sigOut,
                    /* Send-for-Signature editor seed — body HTML + saved
                     * page-shell config so the Edit Header/Footer/Body
                     * popup in the workplace can hydrate without an
                     * extra round-trip. Per-row send-time overrides
                     * layer over these without mutating the saved row. */
                    'content'        => $a->content,
                    'header_config'  => is_array($a->header_config) ? $a->header_config : null,
                    'footer_config'  => is_array($a->footer_config) ? $a->footer_config : null,
                ];
            })->values();

            $segmentsOut[] = [
                'id'         => $seg->id,
                'code'       => $seg->code,
                'name'       => $seg->name,
                'regulatory' => $seg->regulatory_status,
                'agreements' => $agreementsOut,
            ];
        }

        // Totals for the segment-details card. "Segments in this lead"
        // (X) vs "Total segments configured in master" (Y) per tier.
        $masterCounts = ClmSegment::where('client_id', $user->client_id)
            ->where('status', 'active')
            ->selectRaw('regulatory_status, COUNT(*) as c')
            ->groupBy('regulatory_status')
            ->pluck('c', 'regulatory_status');
        $leadCounts = collect($segments)->groupBy('regulatory_status')->map->count();

        // Customer + consignee snapshot — the frontend uses these to
        // resolve signers based on the agreement's `party` CSV.
        $customer  = $lead->customer_id  ? Customer::find($lead->customer_id)   : null;
        $consignee = $lead->consignee_id ? Consignee::find($lead->consignee_id) : null;

        return response()->json([
            'status' => true,
            'data'   => [
                'stage5Complete' => $stage5Complete,
                'lead' => [
                    'id'   => $lead->id,
                    'code' => $lead->opportunity_code ?? null,
                    'customer' => $customer ? [
                        'id'    => $customer->id,
                        'name'  => $customer->company_name,
                        'email' => $customer->primary_email,
                    ] : null,
                    'consignee' => $consignee ? [
                        'id'    => $consignee->id,
                        'name'  => $consignee->company_name,
                        'email' => $consignee->primary_email,
                    ] : null,
                ],
                'pi' => $pi ? [
                    'id'     => $pi->id,
                    'code'   => $pi->code ?? null,
                    'status' => $pi->status ?? null,
                ] : null,
                'quotation' => $quotation ? [
                    'id'     => $quotation->id,
                    'code'   => $quotation->code ?? null,
                    'status' => $quotation->status ?? null,
                ] : null,
                'totals' => [
                    'highly' => [
                        'matched' => (int) ($leadCounts['highly'] ?? 0),
                        'total'   => (int) ($masterCounts['highly'] ?? 0),
                    ],
                    'less' => [
                        'matched' => (int) ($leadCounts['less'] ?? 0),
                        'total'   => (int) ($masterCounts['less'] ?? 0),
                    ],
                ],
                'segments' => $segmentsOut,
            ],
        ]);
    }

    /* ── DOCX round-trip ──
     *   GET  /clm/agreement-library/{id}/download    → returns the user's
     *        uploaded DOCX when present, otherwise generates a fresh one
     *        from the row's `content` HTML.
     *   POST /clm/agreement-library/{id}/upload-docx → stores the user's
     *        revised Word doc and refreshes `content` from its HTML so the
     *        web editor stays in sync.
     */
    public function downloadDocx(Request $request, $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $row  = ClmAgreementLibrary::where('client_id', $user->client_id)->findOrFail($id);

        // Prefer the user-uploaded DOCX (it's the source of truth after a
        // Word round-trip — preserves header/footer/styling we can't fully
        // reproduce from HTML alone).
        if ($row->docx_path && Storage::disk('public')->exists($row->docx_path)) {
            $abs  = Storage::disk('public')->path($row->docx_path);
            $name = $row->docx_original_name ?: ($row->code ?: 'agreement') . '.docx';
            return response()->download($abs, $name);
        }

        $phpWord = new PhpWord();
        $phpWord->setDefaultFontName('Calibri');
        $phpWord->setDefaultFontSize(11);
        $section = $phpWord->addSection();

        $title = trim((string) $row->title) ?: 'Agreement';
        $section->addTitle(htmlspecialchars($title, ENT_QUOTES), 1);
        $section->addTextBreak(1);

        $html = trim((string) $row->content);
        if ($html === '') $html = '<p></p>';

        $html    = $this->normaliseEditorHtml($html);
        $wrapped = '<!DOCTYPE html><html><body>' . $html . '</body></html>';

        try {
            Html::addHtml($section, $wrapped, true, false);
        } catch (\Throwable $e) {
            $section->addText(strip_tags($html));
        }

        $filename = ($row->code ?: 'agreement') . '.docx';
        $tmp      = tempnam(sys_get_temp_dir(), 'agrdocx_');
        IOFactory::createWriter($phpWord, 'Word2007')->save($tmp);

        return response()->download($tmp, $filename, [
            'Content-Type' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        ])->deleteFileAfterSend(true);
    }

    /**
     * GET /clm/agreement-library/{id}/download-pdf
     *
     * Render the sample agreement to a PDF — the row's HTML body wrapped in
     * the saved page-shell header/footer (logo, name, footer text, page
     * numbers). Reuses the shared signature-document blade + dompdf so the
     * output matches the draft preview / what gets sent for signature.
     */
    public function downloadPdf(Request $request, $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $row  = ClmAgreementLibrary::where('client_id', $user->client_id)->findOrFail($id);

        $html = trim((string) $row->content);
        if ($html === '') $html = '<p><em>No content saved for this agreement yet.</em></p>';
        $processedHtml = $this->normaliseEditorHtml($html);

        $headerConfig = is_array($row->header_config) ? $row->header_config : [];
        $footerConfig = is_array($row->footer_config) ? $row->footer_config : [];
        $client = \App\Models\Client::find($row->client_id);

        // dompdf can't fetch /storage URLs — resolve the header logo to base64.
        $urlPath = (isset($headerConfig['logo_url']) && preg_match('#/storage/(.+)$#', (string) $headerConfig['logo_url'], $m)) ? $m[1] : null;
        $headerLogoBase64 = '';
        foreach (array_filter([$headerConfig['logo_path'] ?? null, $urlPath, $client?->logo]) as $path) {
            try {
                if (Storage::disk('public')->exists($path)) { $headerLogoBase64 = base64_encode(Storage::disk('public')->get($path)); break; }
            } catch (\Throwable $e) { /* try next candidate */ }
        }

        $pdf = \Barryvdh\DomPDF\Facade\Pdf::loadView('pdf.clm-signature-document', [
            'document'         => $row,
            'party'            => null,
            'modelName'        => '',
            'processedHtml'    => $processedHtml,
            'generatedDate'    => now()->format('d/m/Y'),
            'requestId'        => $row->code ?: 'SAMPLE',
            'signers'          => [],
            'client'           => $client,
            'headerConfig'     => $headerConfig,
            'footerConfig'     => $footerConfig,
            'headerLogoBase64' => $headerLogoBase64,
        ])->setPaper('a4')->setOption('isPhpEnabled', true);

        return $pdf->download(($row->code ?: 'agreement') . '.pdf');
    }

    public function uploadDocx(Request $request, $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $row  = ClmAgreementLibrary::where('client_id', $user->client_id)->findOrFail($id);

        $request->validate(['docx' => 'required|file|mimes:doc,docx|max:' . self::DOCX_MAX_KB]);

        $file       = $request->file('docx');
        $clientSlug = $user->client_id ? 'c' . $user->client_id : 'public';
        $folder     = "agreement_library/{$clientSlug}/a{$row->id}";
        $ext        = strtolower($file->getClientOriginalExtension() ?: 'docx');
        $filename   = Str::random(16) . '.' . $ext;
        $path       = $file->storeAs($folder, $filename, 'public');

        // Best-effort DOCX → HTML so the web editor reflects the upload.
        $html = $row->content;
        try {
            $html = $this->docxToHtml(Storage::disk('public')->path($path)) ?: $row->content;
        } catch (\Throwable $e) {
            // ignore — keep the previous HTML if parsing failed
        }

        $row->update([
            'docx_path'          => $path,
            'docx_original_name' => $file->getClientOriginalName(),
            'content'            => $html,
            'updated_by'         => $user->id,
        ]);

        return response()->json(['status' => true, 'data' => $row->fresh()]);
    }
}
