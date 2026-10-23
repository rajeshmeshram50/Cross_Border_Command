<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Controllers\Concerns\HandlesDocxHtmlRoundtrip;
use App\Models\ClmAgreementLibrary;
use App\Models\ClmAgreementType;
use App\Models\ClmSegment;
use App\Models\ClmSignatureRequest;
use App\Models\ClmTradeDocLibrary;
use App\Models\Consignee;
use App\Models\Customer;
use App\Models\Lead;
use App\Models\ProformaInvoice;
use App\Models\Quotation;
use App\Models\Product;
use App\Models\SegmentDocUpload;
use App\Support\MasterVisibility;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use PhpOffice\PhpWord\IOFactory;
use PhpOffice\PhpWord\PhpWord;
use PhpOffice\PhpWord\Shared\Html;

class ClmAgreementController extends Controller
{
    use HandlesDocxHtmlRoundtrip;

    private const DOCX_MAX_KB = 1024;

    private const RENDER_MAX_CHARS = 1000000;

    public function typesIndex(Request $request)
    {
        $user = $request->user(); if (!$user) abort(401);
        if (!$user->client_id) {
            return response()->json(['status' => true, 'data' => [], 'count' => 0]);
        }
        $branchFilter = $request->integer('branch_id') ?: null;
        $typeQuery = ClmAgreementType::query()->orderByDesc('id');
        MasterVisibility::applyReadScope($typeQuery, $user, $branchFilter);
        $rows = $typeQuery->get();

        $usageQuery = ClmAgreementLibrary::query();
        MasterVisibility::applyReadScope($usageQuery, $user, $branchFilter);
        $usedCounts = $usageQuery
            ->selectRaw('LOWER(agreement_type) as t, COUNT(*) as c')
            ->groupBy('t')
            ->pluck('c', 't');
        $rows->transform(function ($row) use ($usedCounts) {
            $row->in_use = (int) ($usedCounts[mb_strtolower($row->name)] ?? 0);
            return $row;
        });

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

        $name = trim($data['name']);
        $dupQuery = ClmAgreementType::query()->whereRaw('LOWER(name) = ?', [mb_strtolower($name)]);
        MasterVisibility::applyReadScope($dupQuery, $user, $user->branch_id ?: null);
        if ($dupQuery->exists()) {
            return response()->json([
                'status'  => false,
                'message' => "An agreement type named \"{$name}\" already exists. Pick a different name.",
            ], 409);
        }

        $row = DB::transaction(function () use ($user, $data, $name) {
            DB::table('clients')->where('id', $user->client_id)->lockForUpdate()->first();
            $code = $this->nextCode(ClmAgreementType::class, $user->client_id, $user->branch_id, 'AT-');
            return ClmAgreementType::create([
                'client_id'   => $user->client_id,
                'branch_id'   => $user->branch_id,
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
        $lookup = ClmAgreementType::query()->whereKey($id);
        MasterVisibility::applyReadScope($lookup, $user, $user->branch_id ?: null);
        $row = $lookup->firstOrFail();
        if ($msg = MasterVisibility::hierarchicalDenial($user, $row, 'edit')) {
            return response()->json(['status' => false, 'message' => $msg], 403);
        }

        $inUse = ClmAgreementLibrary::where('client_id', $user->client_id)
            ->whereRaw('LOWER(agreement_type) = ?', [mb_strtolower($row->name)])
            ->count();
        if ($inUse > 0) {
            return response()->json([
                'status'  => false,
                'message' => "This agreement type is used by {$inUse} agreement" . ($inUse === 1 ? '' : 's') . " in the Agreement Library and can no longer be edited.",
            ], 409);
        }

        $data = $request->validate([
            'name'        => 'sometimes|required|string|max:255',
            'description' => 'sometimes|required|string|max:500',
        ]);
        if (isset($data['name']))        $data['name']        = trim($data['name']);
        if (isset($data['description'])) $data['description'] = trim($data['description']);

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
        $lookup = ClmAgreementType::query()->whereKey($id);
        MasterVisibility::applyReadScope($lookup, $user, $user->branch_id ?: null);
        $row = $lookup->firstOrFail();
        if ($msg = MasterVisibility::hierarchicalDenial($user, $row, 'delete')) {
            return response()->json(['status' => false, 'message' => $msg], 403);
        }

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

    private function nextCode(string $modelClass, int $clientId, ?int $branchId, string $prefix): string
    {
        $query = $modelClass::where('client_id', $clientId);
        $branchId === null ? $query->whereNull('branch_id') : $query->where('branch_id', $branchId);
        $codes = $query->pluck('code')->all();
        $maxN  = 0;
        $taken = [];
        $re    = '/^' . preg_quote($prefix, '/') . '(\d+)$/';
        foreach ($codes as $c) {
            if (preg_match($re, (string) $c, $m)) {
                $n = (int) $m[1];
                if ($n > $maxN) $maxN = $n;
            }
            $taken[(string) $c] = true;
        }
        $n = $maxN;
        do {
            $n++;
            $code = sprintf('%s%03d', $prefix, $n);
        } while (isset($taken[$code]));
        return $code;
    }

    public function libraryIndex(Request $request)
    {
        $user = $request->user(); if (!$user) abort(401);
        if (!$user->client_id) {
            return response()->json(['status' => true, 'data' => [], 'count' => 0]);
        }
        $branchFilter = $request->integer('branch_id') ?: null;
        $libQuery = ClmAgreementLibrary::query()->orderBy('id', 'desc');
        MasterVisibility::applyReadScope($libQuery, $user, $branchFilter);
        $rows = $libQuery->get();

        $signedIds = ClmSignatureRequest::signedDraftIds($user->client_id, ClmSignatureRequest::DOC_AGREEMENT);
        $usedIds   = ClmSignatureRequest::usedDraftIds($user->client_id, ClmSignatureRequest::DOC_AGREEMENT);
        $rows->each(function ($r) use ($signedIds, $usedIds) {
            $r->setAttribute('is_signed', in_array((int) $r->id, $signedIds, true));
            $r->setAttribute('in_use', in_array((int) $r->id, $usedIds, true));
            /* The list does not render the document — it shows title, type,
               regulatory, segment and party — but `content` was 92.9% of this
               response: 1,626,331 of 1,750,358 bytes across thirteen rows, one
               of them a 959 kB agreement. The editor fetches the one row it
               opens from libraryShow() below. */
            $r->makeHidden('content');
        });

        return response()->json(['status' => true, 'data' => $rows, 'count' => $rows->count()]);
    }

    /**
     * One agreement, with its document body — what the editor opens.
     *
     * Scoped exactly as libraryIndex() scopes the list, NOT as libraryUpdate()
     * scopes an edit. Those differ: the list passes the requested branch filter
     * while an edit is pinned to the caller's own branch. Scoping this like an
     * edit meant a row the user could see in the list came back 404 when they
     * opened it. Whatever the list showed, this serves; whether it may then be
     * SAVED is still libraryUpdate's decision.
     */
    public function libraryShow(Request $request, $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $lookup = ClmAgreementLibrary::query()->whereKey($id);
        MasterVisibility::applyReadScope($lookup, $user, $request->integer('branch_id') ?: null);

        return response()->json(['status' => true, 'data' => $lookup->firstOrFail()]);
    }

    public function libraryStore(Request $request)
    {
        $user = $request->user(); if (!$user) abort(401);
        if (!$user->client_id) return response()->json(['status' => false, 'message' => 'No tenant context'], 403);

        $data = $request->validate([
            'agreement_type' => 'required|string|max:255',
            'title'          => 'required|string|max:255',
            'purpose'        => 'nullable|string|max:1000',
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
            $code = $this->nextCode(ClmAgreementLibrary::class, $user->client_id, $user->branch_id, 'A-');
            return ClmAgreementLibrary::create([
                'client_id'      => $user->client_id,
                'branch_id'      => $user->branch_id,
                'code'           => $code,
                'agreement_type' => trim($data['agreement_type']),
                'title'          => trim($data['title']),
                'purpose'        => isset($data['purpose']) ? trim($data['purpose']) : null,
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
        /* Without content. The wizard just posted it and awaits this response
           without reading it, so echoing the document back sends it a second
           time for nothing — 1.5 MB on live for an agreement carrying an
           imported Word document, which is most of the 42 s the save took.
           Every other column still goes back. */
        return response()->json(['status' => true, 'data' => $row->makeHidden('content')], 201);
    }

    public function libraryUpdate(Request $request, $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $lookup = ClmAgreementLibrary::query()->whereKey($id);
        MasterVisibility::applyReadScope($lookup, $user, $user->branch_id ?: null);
        $row = $lookup->firstOrFail();
        if ($msg = MasterVisibility::hierarchicalDenial($user, $row, 'edit')) {
            return response()->json(['status' => false, 'message' => $msg], 403);
        }

        if (ClmSignatureRequest::hasUsedDraft($user->client_id, (int) $row->id, ClmSignatureRequest::DOC_AGREEMENT)) {
            return response()->json([
                'status'  => false,
                'message' => 'This agreement is In-use, you cannot edit it.',
            ], 422);
        }

        $data = $request->validate([
            'agreement_type' => 'sometimes|required|string|max:255',
            'title'          => 'sometimes|required|string|max:255',
            'purpose'        => 'nullable|string|max:1000',
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
        if (array_key_exists('content', $data) && $data['content'] !== null && $data['content'] !== $row->content) {
            if ($row->docx_path) {
                try { Storage::disk('public')->delete($row->docx_path); } catch (\Throwable $e) { }
            }
            $data['docx_path'] = null;
            $data['docx_original_name'] = null;
        }
        $row->update($data);
        // Without content — see libraryStore.
        return response()->json(['status' => true, 'data' => $row->fresh()->makeHidden('content')]);
    }

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
        $lookup = ClmAgreementLibrary::query()->whereKey($id);
        MasterVisibility::applyReadScope($lookup, $user, $user->branch_id ?: null);
        $row = $lookup->firstOrFail();
        if ($msg = MasterVisibility::hierarchicalDenial($user, $row, 'delete')) {
            return response()->json(['status' => false, 'message' => $msg], 403);
        }

        if (ClmSignatureRequest::hasReferencingDraft($user->client_id, (int) $row->id, ClmSignatureRequest::DOC_AGREEMENT)) {
            return response()->json([
                'status'  => false,
                'message' => 'This agreement is in use (used in a lead / sent for signature) and cannot be deleted.',
            ], 422);
        }

        $row->delete();
        return response()->json(['status' => true, 'message' => 'Deleted']);
    }

    public function applicableForLead(Request $request, $leadId)
    {
        $user = $request->user(); if (!$user) abort(401);

        $lead = Lead::where('client_id', $user->client_id)->findOrFail((int) $leadId);

        $light = $request->boolean('light');

        $stage5Complete = (int) ($lead->lead_stage_id ?? 1) >= 6;

        $pi = ProformaInvoice::where('client_id', $user->client_id)
            ->where('opp_id', $lead->id)
            ->where('status', '!=', 'cancelled')
            ->orderByDesc('id')
            ->first();

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

        $sigRows = $source
            ? ClmSignatureRequest::where('client_id', $user->client_id)
                ->where('document_type', ClmSignatureRequest::DOC_AGREEMENT)
                ->where('lead_id', $lead->id)
                ->whereNull('deleted_at')
                ->orderByDesc('id')
                ->get()
            : collect();

        $latestPerAgreement = [];
        foreach ($sigRows as $r) {
            $ids = is_array($r->trade_doc_ids) ? $r->trade_doc_ids : [];
            foreach ($ids as $aid) {
                if (!isset($latestPerAgreement[$aid])) {
                    $latestPerAgreement[$aid] = $r;
                }
            }
        }

        $tdSigRows = $source
            ? ClmSignatureRequest::where('client_id', $user->client_id)
                ->where('document_type', ClmSignatureRequest::DOC_TRADE)
                ->where('lead_id', $lead->id)
                ->whereNull('deleted_at')
                ->orderByDesc('id')
                ->get()
            : collect();
        $latestPerTradeDoc = [];
        foreach ($tdSigRows as $r) {
            $ids = is_array($r->trade_doc_ids) && !empty($r->trade_doc_ids)
                ? $r->trade_doc_ids
                : [$r->trade_doc_id];
            foreach ((array) $ids as $tid) {
                $tid = (int) $tid;
                if ($tid && !isset($latestPerTradeDoc[$tid])) {
                    $latestPerTradeDoc[$tid] = $r;
                }
            }
        }

        $customer  = $lead->customer_id  ? Customer::with('primaryAddress')->find($lead->customer_id)   : null;
        $consignee = $lead->consignee_id ? Consignee::with('primaryAddress')->find($lead->consignee_id) : null;
        $partyOwners = array_values(array_filter([
            $customer  ? ['party' => 'customer',  'model' => $customer]  : null,
            $consignee ? ['party' => 'consignee', 'model' => $consignee] : null,
        ]));

        $buyerEqualsConsignee = !$consignee || (bool) ($consignee->same_as_customer ?? false);

        $needs = [];
        if (Schema::hasTable('clm_lead_doc_needs')) {
            foreach (DB::table('clm_lead_doc_needs')->where('lead_id', $lead->id)->get() as $n) {
                $needs[$n->doc_kind . ':' . $n->doc_id] = (bool) $n->needed;
            }
        }

        $piDocSig = $pi
            ? ClmSignatureRequest::where('client_id', $user->client_id)
                ->where('lead_id', $lead->id)
                ->where('document_type', ClmSignatureRequest::DOC_PROFORMA_INVOICE)
                ->whereNull('deleted_at')
                ->orderByDesc('id')
                ->first()
            : null;

        $segmentsOut = [];
        foreach ($segments as $seg) {
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
                ->get()
                ->filter(fn (ClmAgreementLibrary $a) => $this->partyIncluded($a->party, $buyerEqualsConsignee))
                ->values();

            $agreementsOut = $agreements->map(function (ClmAgreementLibrary $a) use ($latestPerAgreement, $needs, $light) {
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
                    'needed'         => $needs['agreement:' . $a->id] ?? null,
                    'updated_at'     => optional($a->updated_at)->toDateString(),
                    'signature_request' => $sigOut,
                    'content'        => $light ? null : $a->content,
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
                'trade_documents' => $this->segmentTradeDocs($seg, (int) $user->client_id, $partyOwners, $latestPerTradeDoc, $needs, $buyerEqualsConsignee),
            ];
        }

        $masterCounts = ClmSegment::where('client_id', $user->client_id)
            ->where('status', 'active')
            ->selectRaw('regulatory_status, COUNT(*) as c')
            ->groupBy('regulatory_status')
            ->pluck('c', 'regulatory_status');
        $leadCounts = collect($segments)->groupBy('regulatory_status')->map->count();

        return response()->json([
            'status' => true,
            'data'   => [
                'stage5Complete'       => $stage5Complete,
                'buyerEqualsConsignee' => $buyerEqualsConsignee,
                'lead' => [
                    'id'   => $lead->id,
                    'code' => $lead->opportunity_code ?? null,
                    'customer' => $customer ? [
                        'id'      => $customer->id,
                        'code'    => $customer->customer_code,
                        'name'    => $customer->company_name,
                        'email'   => $customer->primary_email,
                        'country' => $customer->primaryAddress?->country,
                        'segment' => $customer->segment,
                    ] : null,
                    'consignee' => $consignee ? [
                        'id'      => $consignee->id,
                        'code'    => $consignee->consignee_code,
                        'name'    => $consignee->company_name,
                        'email'   => $consignee->primary_email,
                        'country' => $consignee->primaryAddress?->country,
                        'segment' => $consignee->segment,
                    ] : null,
                ],
                'pi' => $pi ? [
                    'id'     => $pi->id,
                    'code'   => $pi->code ?? null,
                    'status' => $pi->status ?? null,
                ] : null,
                'pi_document' => $pi ? [
                    'pi_id'   => (int) $pi->id,
                    'pi_code' => (string) ($pi->code ?: ('PI-' . $pi->id)),
                    'name'    => 'Proforma Invoice (' . ($pi->code ?: ('PI-' . $pi->id)) . ')',
                    'status'  => $piDocSig?->status ?? 'Pending',
                    'signature_request' => $piDocSig ? (function () use ($piDocSig) {
                        $signedPaths = is_array($piDocSig->signed_document_paths) ? $piDocSig->signed_document_paths : [];
                        $first = $signedPaths[0] ?? [];
                        return [
                            'id'                    => $piDocSig->id,
                            'status'                => $piDocSig->status,
                            'sent_at'               => optional($piDocSig->created_at)->toIso8601String(),
                            'completed_at'          => optional($piDocSig->completed_at)->toIso8601String(),
                            'signed_url'            => $first['file_url'] ?? $first['url'] ?? null,
                            'certificate_url'       => $piDocSig->certificate_path ? file_url($piDocSig->certificate_path) : null,
                            'reminder_count'        => (int) ($piDocSig->reminder_count ?? 0),
                            'last_reminder_sent_at' => optional($piDocSig->last_reminder_sent_at)->toIso8601String(),
                        ];
                    })() : null,
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

    private function partyForBuyerConsignee(?string $party): array
    {
        $tokens = array_filter(array_map(
            fn ($t) => strtolower(trim($t)),
            explode(',', (string) $party)
        ));
        $forBuyer     = in_array('buyer', $tokens, true);
        $forConsignee = in_array('consignee', $tokens, true);

        if (empty($tokens)) {
            return [true, true, true];
        }
        return [$forBuyer || $forConsignee, $forBuyer, $forConsignee];
    }

    private function partyIncluded(?string $party, bool $buyerEqualsConsignee): bool
    {
        [$applicable, $forBuyer, $forConsignee] = $this->partyForBuyerConsignee($party);
        if (!$applicable) return false;
        return $buyerEqualsConsignee ? ($forBuyer && !$forConsignee) : true;
    }

    public function setLeadDocNeed(Request $request, int $leadId)
    {
        $user = $request->user(); if (!$user) abort(401);

        $data = $request->validate([
            'items'             => ['required', 'array', 'min:1'],
            'items.*.doc_kind'  => ['required', 'in:trade_doc,agreement'],
            'items.*.doc_id'    => ['required', 'integer'],
            'items.*.needed'    => ['required', 'boolean'],
        ]);

        $lead = Lead::where('client_id', $user->client_id)->findOrFail($leadId);

        foreach ($data['items'] as $it) {
            DB::table('clm_lead_doc_needs')->updateOrInsert(
                ['lead_id' => $lead->id, 'doc_kind' => $it['doc_kind'], 'doc_id' => (int) $it['doc_id']],
                [
                    'client_id'  => $user->client_id,
                    'needed'     => (bool) $it['needed'],
                    'decided_by' => $user->id,
                    'updated_at' => now(),
                    'created_at' => now(),
                ],
            );
        }

        return response()->json(['status' => true, 'saved' => count($data['items'])]);
    }

    private function segmentTradeDocs($seg, int $cid, array $partyOwners, array $latestPerTradeDoc = [], array $needs = [], bool $buyerEqualsConsignee = false): array
    {
        $name = $seg->name;
        $code = $seg->code;
        $docs = ClmTradeDocLibrary::where('client_id', $cid)
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
            ->where('status', 'active')
            ->orderBy('id')
            ->get();
        if ($docs->isEmpty()) return [];

        $uploadsByOwner = [];
        foreach ($partyOwners as $owner) {
            $model = $owner['model'];
            $uploadsByOwner[$owner['party']] = SegmentDocUpload::where('uploadable_type', get_class($model))
                ->where('uploadable_id', $model->id)
                ->where('category', 'td')
                ->get()
                ->keyBy('doc_code');
        }

        $out = [];
        foreach ($docs as $m) {
            $docCode = $m->code;

            [, $forBuyer, $forConsignee] = $this->partyForBuyerConsignee($m->party);
            if (!$this->partyIncluded($m->party, $buyerEqualsConsignee)) { continue; }

            $uploaded = null;
            foreach ($uploadsByOwner as $ups) {
                if ($hit = $ups->get($docCode)) { $uploaded = $hit; break; }
            }

            $req = $latestPerTradeDoc[(int) $m->id] ?? null;
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
                    'reminder_count'        => (int) ($req->reminder_count ?? 0),
                    'last_reminder_sent_at' => optional($req->last_reminder_sent_at)->toIso8601String(),
                ];
            }

            $out[] = [
                'db_id'            => $m->id,
                'name'             => $m->name ?? ($m->title ?? $docCode),
                'title'            => $m->title ?? ($m->name ?? $docCode),
                'reference'        => $m->code ?? $docCode,
                'doc_code'         => (string) $docCode,
                'requirement'      => $seg->regulatory_status === 'highly' ? 'M' : 'O',
                'needed'           => $needs['trade_doc:' . $m->id] ?? null,
                'applicable_party' => (string) ($m->party ?? ''),
                'for_buyer'        => $forBuyer,
                'for_consignee'    => $forConsignee,
                'status'           => $uploaded ? 'Verified' : 'Pending',
                'attachment'       => $uploaded?->attachment_name,
                'attachment_url'   => $uploaded?->attachment_url,
                'signature_request' => $sigOut,
            ];
        }
        return $out;
    }

    public function downloadDocx(Request $request, $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $lookup = ClmAgreementLibrary::query()->whereKey($id);
        MasterVisibility::applyReadScope($lookup, $user, $user->branch_id ?: null);
        $row = $lookup->firstOrFail();

        @ini_set('memory_limit', '1024M');
        @set_time_limit(300);

        $sizeRequested = $request->filled('size') || $request->filled('orient');
        if (!$sizeRequested && $row->docx_path && Storage::disk('public')->exists($row->docx_path)) {
            $name = $row->docx_original_name ?: ($row->code ?: 'agreement') . '.docx';
            try {
                return Storage::disk('public')->download($row->docx_path, $name);
            } catch (\Throwable $e) {
            }
        }

        $phpWord = new PhpWord();
        $phpWord->setDefaultFontName('Arial');
        $phpWord->setDefaultFontSize(11);
        $section = $phpWord->addSection($this->docxPageStyle($request));

        $headerCfg = is_array($row->header_config) ? $row->header_config : [];
        $footerCfg = is_array($row->footer_config) ? $row->footer_config : [];
        $client    = \App\Models\Client::find($row->client_id);
        $urlPath = null;
        $rawLogoUrl = (string) ($headerCfg['logo_url'] ?? '');
        if ($rawLogoUrl !== '') {
            if (preg_match('#/storage/(.+)$#', $rawLogoUrl, $lm)) {
                $urlPath = $lm[1];
            } elseif (preg_match('#^https?://[^/]+/[^/]+/(.+)$#', $rawLogoUrl, $lm)) {
                $urlPath = $lm[1];
            }
        }
        $logoAbs   = null;
        $branch = $row->branch_id ? \App\Models\Branch::find($row->branch_id) : null;
        foreach (array_filter([$headerCfg['logo_path'] ?? null, $urlPath, $branch?->logo, $client?->logo]) as $path) {
            $logoAbs = self::docxLogoFile($path);
            if ($logoAbs) break;
        }
        if (!$logoAbs) {
            Log::warning('Agreement DOCX header logo unresolved', [
                'agreement_id' => $row->id,
                'logo_path'    => $headerCfg['logo_path'] ?? null,
                'logo_url'     => $headerCfg['logo_url'] ?? null,
            ]);
        }
        $this->applyDocxHeaderFooter($section, $headerCfg, $footerCfg, $logoAbs);

        if (($len = $this->htmlTextLength($row->content)) > $this->renderLimitWithMargin(self::RENDER_MAX_CHARS)) {
            return response()->json([
                'status'  => false,
                'message' => 'This agreement is too large to generate as a Word file — '
                    . number_format(round($len / 1024 / 1024, 2), 2) . ' MB (' . number_format($len) . ' characters). '
                    . 'The limit is ' . number_format(self::RENDER_MAX_CHARS) . ' characters of text. Please shorten or split it into smaller agreements.',
            ], 422);
        }

        $html = trim((string) $row->content);
        if ($html === '') $html = '<p></p>';

        $html    = $this->normaliseEditorHtml($html);
        $html    = $this->ensureTableColWidths($html);
        $html    = $this->toWellFormedHtml($html);

        $this->addHtmlResilient($section, $html);

        $filename = ($row->code ?: 'agreement') . '.docx';
        $tmp      = tempnam(sys_get_temp_dir(), 'agrdocx_');
        IOFactory::createWriter($phpWord, 'Word2007')->save($tmp);

        $this->sanitizeDocxXml($tmp, $this->docxUsableWidthTwips($request));

        return response()->download($tmp, $filename, [
            'Content-Type' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        ])->deleteFileAfterSend(true);
    }

    public function downloadPdf(Request $request, $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $lookup = ClmAgreementLibrary::query()->whereKey($id);
        MasterVisibility::applyReadScope($lookup, $user, $user->branch_id ?: null);
        $row = $lookup->firstOrFail();

        @ini_set('memory_limit', '1024M');
        @set_time_limit(300);

        if (($len = $this->htmlTextLength($row->content)) > $this->renderLimitWithMargin(self::RENDER_MAX_CHARS)) {
            return response()->json([
                'status'  => false,
                'message' => 'This agreement is too large to generate as a PDF — '
                    . number_format(round($len / 1024 / 1024, 2), 2) . ' MB (' . number_format($len) . ' characters). '
                    . 'The limit is ' . number_format(self::RENDER_MAX_CHARS) . ' characters of text. Please shorten or split it into smaller agreements.',
            ], 422);
        }

        $html = trim((string) $row->content);
        if ($html === '') $html = '<p><em>No content saved for this agreement yet.</em></p>';
        $processedHtml = $this->normaliseEditorHtml($html);

        $headerConfig = is_array($row->header_config) ? $row->header_config : [];
        $footerConfig = is_array($row->footer_config) ? $row->footer_config : [];
        $client = \App\Models\Client::find($row->client_id);

        $urlPath = (isset($headerConfig['logo_url']) && preg_match('#/storage/(.+)$#', (string) $headerConfig['logo_url'], $m)) ? $m[1] : null;
        $headerLogoBase64 = '';
        foreach (array_filter([$headerConfig['logo_path'] ?? null, $urlPath, $client?->logo]) as $path) {
            try {
                if (Storage::disk('public')->exists($path)) { $headerLogoBase64 = base64_encode(Storage::disk('public')->get($path)); break; }
            } catch (\Throwable $e) { }
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
        ])->setPaper(
            strtolower((string) $request->query('size', 'a4')) === 'a3' ? 'a3' : 'a4',
            strtolower((string) $request->query('orient', 'portrait')) === 'landscape' ? 'landscape' : 'portrait'
        )->setOption('isPhpEnabled', true);

        return $pdf->download(($row->code ?: 'agreement') . '.pdf');
    }

    public function uploadDocx(Request $request, $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $lookup = ClmAgreementLibrary::query()->whereKey($id);
        MasterVisibility::applyReadScope($lookup, $user, $user->branch_id ?: null);
        $row = $lookup->firstOrFail();
        if ($msg = MasterVisibility::hierarchicalDenial($user, $row, 'edit')) {
            return response()->json(['status' => false, 'message' => $msg], 403);
        }

        $request->validate(['docx' => ['required', 'file', 'max:' . self::DOCX_MAX_KB]]);
        $uploadExt = strtolower((string) $request->file('docx')->getClientOriginalExtension());
        if (!in_array($uploadExt, ['doc', 'docx'], true)) {
            throw \Illuminate\Validation\ValidationException::withMessages([
                'docx' => 'The file must be a Word document (.doc or .docx).',
            ]);
        }

        @ini_set('memory_limit', '1024M');
        @set_time_limit(300);

        $file       = $request->file('docx');
        $clientSlug = $user->client_id ? 'c' . $user->client_id : 'public';
        $folder     = "agreement_library/{$clientSlug}/a{$row->id}";
        $ext        = strtolower($file->getClientOriginalExtension() ?: 'docx');
        $filename   = Str::random(16) . '.' . $ext;
        $path       = $file->storeAs($folder, $filename, 'public');

        $html = null;
        $convFailed = false;
        $tmpDocx = tempnam(sys_get_temp_dir(), 'docxconv_') . '.docx';
        try {
            file_put_contents($tmpDocx, Storage::disk('public')->get($path));
            $html = $this->docxToHtml($tmpDocx);
        } catch (\Throwable $e) {
            $convFailed = true;
        } finally {
            @unlink($tmpDocx);
        }

        if ($convFailed || trim(strip_tags((string) $html)) === '') {
            Storage::disk('public')->delete($path);
            return response()->json([
                'status'  => false,
                'message' => $ext === 'doc'
                    ? 'This looks like an older .doc file, which can\'t be read. Open it in Word and use "Save As → Word Document (.docx)", then upload the .docx.'
                    : 'We couldn\'t read any content from this Word file. Make sure it\'s a valid .docx that contains text, then try again.',
            ], 422);
        }

        if (($len = $this->htmlTextLength($html)) > $this->renderLimitWithMargin(self::RENDER_MAX_CHARS)) {
            Storage::disk('public')->delete($path);
            return response()->json([
                'status'  => false,
                'message' => 'This document is too large — '
                    . number_format(round($len / 1024 / 1024, 2), 2) . ' MB (' . number_format($len) . ' characters). '
                    . 'The limit is ' . number_format(self::RENDER_MAX_CHARS) . ' characters of text. Please upload a smaller file or split it.',
            ], 422);
        }

        $row->update([
            'docx_path'          => $path,
            'docx_original_name' => $file->getClientOriginalName(),
            'content'            => $html,
            'updated_by'         => $user->id,
        ]);

        return response()->json(['status' => true, 'data' => $row->fresh()]);
    }

    public function previewLive(Request $request)
    {
        @ini_set('memory_limit', '1024M');
        @set_time_limit(120);

        $user = $request->user();
        if (!$user) abort(401);

        $data = $request->validate([
            'id'            => 'nullable|integer',
            'content'       => 'nullable|string',
            'page_config'   => 'nullable|array',
            'header_config' => 'nullable|array',
            'footer_config' => 'nullable|array',
        ]);

        $row = null;
        if (!empty($data['id'])) {
            $row = ClmAgreementLibrary::where('client_id', $user->client_id)->find($data['id']);
        }

        $html = trim((string) ($data['content'] ?? ($row->content ?? '')));
        if ($html === '') {
            $html = '<p><em>Nothing to preview yet — start typing in the editor.</em></p>';
        }

        if (($len = $this->htmlTextLength($html)) > $this->renderLimitWithMargin(self::RENDER_MAX_CHARS)) {
            return response()->json([
                'status'  => false,
                'message' => 'This draft is too large to preview — ' . number_format($len)
                    . ' characters against a limit of ' . number_format(self::RENDER_MAX_CHARS) . '.',
            ], 422);
        }

        $processedHtml = preg_replace('/\{\{[^{}]*\}\}/', '', $html);

        $client       = \App\Models\Client::find($user->client_id);
        $headerConfig = $data['header_config'] ?? (is_array($row->header_config ?? null) ? $row->header_config : []);
        $footerConfig = $data['footer_config'] ?? (is_array($row->footer_config ?? null) ? $row->footer_config : []);
        $pageConfig   = $data['page_config']   ?? [];

        $urlPath = (isset($headerConfig['logo_url']) && preg_match('#/storage/(.+)$#', (string) $headerConfig['logo_url'], $lm)) ? $lm[1] : null;
        $headerLogoBase64 = '';
        foreach (array_filter([$headerConfig['logo_path'] ?? null, $urlPath, $client?->logo]) as $path) {
            try {
                if (Storage::disk('public')->exists($path)) {
                    $headerLogoBase64 = base64_encode(Storage::disk('public')->get($path));
                    break;
                }
            } catch (\Throwable $e) { }
        }

        $document = $row ?: new ClmAgreementLibrary(['title' => 'Agreement (draft preview)']);

        $cacheKey = 'clm:agrpreview:' . sha1(implode('|', [
            (int) $user->client_id,
            (string) ($row->code ?? 'DRAFT'),
            md5($processedHtml),
            md5(json_encode($headerConfig)),
            md5(json_encode($footerConfig)),
            md5(json_encode($pageConfig)),
            md5((string) $headerLogoBase64),
            now()->format('Y-m-d'),
        ]));
        $headers = [
            'Content-Type'        => 'application/pdf',
            'Content-Disposition' => 'inline; filename="agreement-preview.pdf"',
        ];
        try {
            if ($hit = \Illuminate\Support\Facades\Cache::get($cacheKey)) {
                return response(base64_decode($hit), 200, $headers);
            }
        } catch (\Throwable $e) {
        }

        $pdf = \Barryvdh\DomPDF\Facade\Pdf::loadView('pdf.clm-signature-document', [
            'document'         => $document,
            'party'            => null,
            'modelName'        => 'Agreement',
            'processedHtml'    => $processedHtml,
            'generatedDate'    => now()->format('d/m/Y'),
            'requestId'        => (string) ($row->code ?? 'DRAFT'),
            'signers'          => [],
            'client'           => $client,
            'headerConfig'     => $headerConfig,
            'footerConfig'     => $footerConfig,
            'pageConfig'       => $pageConfig,
            'headerLogoBase64' => $headerLogoBase64,
        ])->setPaper('a4')->setOption('isPhpEnabled', true);

                $bytes = $pdf->output();
        if (strlen($bytes) <= 5 * 1024 * 1024) {
            try {
                \Illuminate\Support\Facades\Cache::put($cacheKey, base64_encode($bytes), now()->addMinutes(10));
            } catch (\Throwable $e) {
            }
        }

        return response($bytes, 200, $headers);
    }

}
