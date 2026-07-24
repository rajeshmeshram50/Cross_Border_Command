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

    /**
     * Max editor-HTML size we'll render synchronously to PDF/Word. dompdf and
     * PhpWord are near-quadratic on long content, so past this a single web
     * request exhausts memory/time and crashes with a 500. Above it we return a
     * clean "too large" message instead of letting the process die.
     */
    private const RENDER_MAX_CHARS = 1000000;   // 1,000,000 chars (~1 MB of HTML)

    /* ── TYPES ── */

    public function typesIndex(Request $request)
    {
        $user = $request->user(); if (!$user) abort(401);
        if (!$user->client_id) {
            return response()->json(['status' => true, 'data' => [], 'count' => 0]);
        }
        // Branch-scoped read: branch users see globals + client-level rows +
        // their own branch's rows; sibling branches stay hidden.
        $branchFilter = $request->integer('branch_id') ?: null;
        $typeQuery = ClmAgreementType::query()->orderBy('id');
        MasterVisibility::applyReadScope($typeQuery, $user, $branchFilter);
        $rows = $typeQuery->get();

        // Flag each type with how many Agreement Library rows reference it
        // (matched by name, case-insensitive) so the UI can lock the edit action
        // for types already in use — only fresh types stay editable (CBC-438).
        // Scope the usage count the same way so a branch only counts library
        // rows it can actually see.
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

        // Reject duplicate agreement-type names within the creator's own scope
        // (case-insensitive). Scoped via MasterVisibility so the same name can
        // exist in different branches — matches the branch-scoped master rule.
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
                'branch_id'   => $user->branch_id,   // branch-owned; null for client-level users → shared
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
        // A branch user can VIEW shared client-level types but not manage them.
        if ($msg = MasterVisibility::hierarchicalDenial($user, $row, 'edit')) {
            return response()->json(['status' => false, 'message' => $msg], 403);
        }

        // Lock editing once the type is referenced by an Agreement Library row —
        // the library matches by name, so a rename would orphan those agreements.
        // Only fresh (unused) types may be edited (CBC-438).
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
        $lookup = ClmAgreementType::query()->whereKey($id);
        MasterVisibility::applyReadScope($lookup, $user, $user->branch_id ?: null);
        $row = $lookup->firstOrFail();
        if ($msg = MasterVisibility::hierarchicalDenial($user, $row, 'delete')) {
            return response()->json(['status' => false, 'message' => $msg], 403);
        }

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

    /**
     * Allocate the next per-tenant code (AT-NNN / A-NNN). Uses
     * MAX(numeric suffix) + 1 rather than count()+1 so a deleted row in the
     * middle of the sequence doesn't make the next allocation reuse a code
     * that still exists — which was throwing a unique-constraint violation
     * (clm_agreement_types_client_id_code_unique) on save. Skips any code
     * that's already taken just to be doubly safe. Caller must already hold
     * the client row lock; the composite UNIQUE (client_id, code) is the
     * final guard.
     *
     * @param class-string<\Illuminate\Database\Eloquent\Model> $modelClass
     */
    private function nextCode(string $modelClass, int $clientId, ?int $branchId, string $prefix): string
    {
        // Branch-scoped so each branch restarts its own sequence from
        // 001 (AT-001 / A-001) rather than continuing another branch's
        // tally — the agreement master is branch-isolated via
        // MasterVisibility. A client-level creator ($branchId null)
        // sequences the shared rows.
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

    /* ── LIBRARY ── */

    public function libraryIndex(Request $request)
    {
        $user = $request->user(); if (!$user) abort(401);
        if (!$user->client_id) {
            return response()->json(['status' => true, 'data' => [], 'count' => 0]);
        }
        // Branch-scoped read (globals + client-level + own branch; siblings hidden).
        $branchFilter = $request->integer('branch_id') ?: null;
        $libQuery = ClmAgreementLibrary::query()->orderBy('id');
        MasterVisibility::applyReadScope($libQuery, $user, $branchFilter);
        $rows = $libQuery->get();

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
                'branch_id'      => $user->branch_id,   // branch-owned; null for client-level users → shared
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
        return response()->json(['status' => true, 'data' => $row], 201);
    }

    public function libraryUpdate(Request $request, $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $lookup = ClmAgreementLibrary::query()->whereKey($id);
        MasterVisibility::applyReadScope($lookup, $user, $user->branch_id ?: null);
        $row = $lookup->firstOrFail();
        // Branch users may view shared client-level agreements but not edit them.
        if ($msg = MasterVisibility::hierarchicalDenial($user, $row, 'edit')) {
            return response()->json(['status' => false, 'message' => $msg], 403);
        }

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
        $lookup = ClmAgreementLibrary::query()->whereKey($id);
        MasterVisibility::applyReadScope($lookup, $user, $user->branch_id ?: null);
        $row = $lookup->firstOrFail();
        if ($msg = MasterVisibility::hierarchicalDenial($user, $row, 'delete')) {
            return response()->json(['status' => false, 'message' => $msg], 403);
        }

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

        // Same lookup for TRADE-DOCUMENT sends, keyed by trade-doc-library id,
        // so each trade-doc row can surface its live signature status (Sent /
        // Signed), the Remind button + count, and the signed-PDF / certificate
        // download links — exactly like the agreement rows.
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

        // Customer + consignee mapped to this lead. Resolved up-front (it
        // used to sit below the loop) because the per-segment trade-document
        // block now needs both parties' upload state inside the loop.
        // Eager-load the primary address so the Trade Documents popup header
        // can surface each party's country (it lives on customer_addresses /
        // consignee_addresses, not the party row itself).
        $customer  = $lead->customer_id  ? Customer::with('primaryAddress')->find($lead->customer_id)   : null;
        $consignee = $lead->consignee_id ? Consignee::with('primaryAddress')->find($lead->consignee_id) : null;
        $partyOwners = array_values(array_filter([
            $customer  ? ['party' => 'customer',  'model' => $customer]  : null,
            $consignee ? ['party' => 'consignee', 'model' => $consignee] : null,
        ]));

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
                ->get()
                // Exclude supplier/other-only agreements — the Sales Matrix only
                // sends to the customer / consignee side.
                ->filter(fn (ClmAgreementLibrary $a) => $this->partyForBuyerConsignee($a->party)[0])
                ->values();

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
                // Trade documents required for THIS segment, for both the
                // customer and the consignee — moved here from the per-party
                // Evidence Vault so they're surfaced segment-wise.
                'trade_documents' => $this->segmentTradeDocs($seg, (int) $user->client_id, $partyOwners, $latestPerTradeDoc),
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

        // ($customer / $consignee resolved before the segment loop above —
        // the frontend uses these to resolve signers based on the
        // agreement's `party` CSV.)

        // Buyer == Consignee when there's no distinct consignee, or the mapped
        // consignee is flagged same-as-customer. Drives the Trade Documents
        // popup: equal ⇒ one flat list; different ⇒ Buyer/Consignee/Both tabs.
        $buyerEqualsConsignee = !$consignee || (bool) ($consignee->same_as_customer ?? false);

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

    /**
     * Resolve a library row's `party` CSV against the Sales Matrix context,
     * which only ever deals with the buyer (customer) / consignee side.
     *
     * A row is applicable here when its party names Buyer or Consignee. Rows
     * that name only Supplier/other parties (e.g. "Supplier-Material / Goods")
     * are NOT applicable and must be excluded — previously they slipped through
     * because "names neither" fell back to "both". A blank party stays
     * universal (applicable to both), preserving the old permissive behaviour
     * for unclassified rows.
     *
     * @return array{0:bool,1:bool,2:bool}  [applicable, forBuyer, forConsignee]
     */
    private function partyForBuyerConsignee(?string $party): array
    {
        $tokens = array_filter(array_map(
            fn ($t) => strtolower(trim($t)),
            explode(',', (string) $party)
        ));
        $forBuyer     = in_array('buyer', $tokens, true);
        $forConsignee = in_array('consignee', $tokens, true);

        // Unclassified (blank party) → applies to both, so it's never hidden.
        if (empty($tokens)) {
            return [true, true, true];
        }
        // Named parties but neither Buyer nor Consignee → supplier/other-only,
        // not applicable in the customer/consignee sales-matrix context.
        return [$forBuyer || $forConsignee, $forBuyer, $forConsignee];
    }

    /**
     * Trade documents required for a single segment, ONE row per document.
     * Each row carries the document's applicable party (parsed from the trade
     * doc master's `party` CSV → for_buyer / for_consignee) so the Sales Matrix
     * popup can segregate into Buyer / Consignee / Both tabs. Upload status is
     * unioned across the mapped parties (uploaded by either ⇒ Verified).
     *
     * @param  array<int,array{party:string,model:Model}>  $partyOwners
     * @return array<int,array<string,mixed>>
     */
    private function segmentTradeDocs($seg, int $cid, array $partyOwners, array $latestPerTradeDoc = []): array
    {
        // Trade documents now carry their own `regulatory` + `segment` (CSV)
        // columns — exactly like the Agreement Library — instead of being
        // selected on the DCP segment rule. So we resolve them the SAME way
        // agreements are: match the library's regulatory tier + segment CSV
        // against this segment's name/code. (Previously this read the segment
        // rule's doc_selections['td'], which no longer exists.)
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

        // Upload state keyed by doc_code, per mapped party owner.
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

            // Applicable party comes from the master's `party` CSV (e.g.
            // "Buyer,Consignee,Supplier-Material"). Supplier/other-only docs are
            // not applicable in the customer/consignee context and are skipped.
            [$applicable, $forBuyer, $forConsignee] = $this->partyForBuyerConsignee($m->party);
            if (!$applicable) { continue; }

            // Verified if EITHER mapped party has uploaded this code.
            $uploaded = null;
            foreach ($uploadsByOwner as $ups) {
                if ($hit = $ups->get($docCode)) { $uploaded = $hit; break; }
            }

            // Live signature status for this trade doc (latest Zoho send on
            // this lead) — drives the Sent/Signed badge, Remind button + count,
            // and signed-PDF / certificate downloads, same as agreements.
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
                // `name` is the catalog/type name (shared across docs); `title`
                // is this document's own title. The popup shows the title as the
                // primary label, falling back to name/code when blank.
                'name'             => $m->name ?? ($m->title ?? $docCode),
                'title'            => $m->title ?? ($m->name ?? $docCode),
                'reference'        => $m->code ?? $docCode,
                'doc_code'         => (string) $docCode,
                // Highly-regulated trade docs read as required (REQ); less-reg
                // as optional — same convention as agreements.
                'requirement'      => $seg->regulatory_status === 'highly' ? 'M' : 'O',
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
        $lookup = ClmAgreementLibrary::query()->whereKey($id);
        MasterVisibility::applyReadScope($lookup, $user, $user->branch_id ?: null);
        $row = $lookup->firstOrFail();

        // DOCX generation (PhpWord HTML reader + Word2007 writer) is memory-
        // and time-heavy for table-rich documents. The web SAPI's default
        // limits can be lower than CLI, producing intermittent OOM 500s that
        // surface to the user as a generic "Download failed". Raise both
        // defensively for this request only. Mirrors the Trade Doc flow.
        @ini_set('memory_limit', '1024M');
        @set_time_limit(300);

        // Prefer the user-uploaded DOCX (it's the source of truth after a
        // Word round-trip — preserves header/footer/styling we can't fully
        // reproduce from HTML alone).
        if ($row->docx_path && Storage::disk('public')->exists($row->docx_path)) {
            $name = $row->docx_original_name ?: ($row->code ?: 'agreement') . '.docx';
            try {
                // Stream via the Storage disk — works for both local and cloud
                // disks (Azure Blob). response()->download() needs a real local
                // path and 500s on a cloud disk; on any read failure we fall
                // through and regenerate the DOCX from the row's content below.
                return Storage::disk('public')->download($row->docx_path, $name);
            } catch (\Throwable $e) {
                // fall through to regeneration
            }
        }

        $phpWord = new PhpWord();
        $phpWord->setDefaultFontName('Calibri');
        $phpWord->setDefaultFontSize(11);
        $section = $phpWord->addSection();

        // Page-shell header + footer (logo, title, "Confidential", footer text,
        // page number) from the saved config — so the DOCX matches the editor's
        // preview / the PDF instead of a bare body. Reflects the latest saved
        // header_config, including any logo/position changes.
        $headerCfg = is_array($row->header_config) ? $row->header_config : [];
        $footerCfg = is_array($row->footer_config) ? $row->footer_config : [];
        $client    = \App\Models\Client::find($row->client_id);
        $urlPath   = (isset($headerCfg['logo_url']) && preg_match('#/storage/(.+)$#', (string) $headerCfg['logo_url'], $lm)) ? $lm[1] : null;
        $logoAbs   = null;
        foreach (array_filter([$headerCfg['logo_path'] ?? null, $urlPath, $client?->logo]) as $path) {
            try {
                if (Storage::disk('public')->exists($path)) { $logoAbs = Storage::disk('public')->path($path); break; }
            } catch (\Throwable $e) { /* try next candidate */ }
        }
        $this->applyDocxHeaderFooter($section, $headerCfg, $footerCfg, $logoAbs);

        // Guard oversized content: past this, PhpWord crashes the request (500).
        // Return a clean message the UI can show instead.
        if (($len = mb_strlen((string) $row->content)) > self::RENDER_MAX_CHARS) {
            return response()->json([
                'status'  => false,
                'message' => 'This agreement is too large to generate as a Word file — '
                    . number_format(round($len / 1024 / 1024, 2), 2) . ' MB (' . number_format($len) . ' characters). '
                    . 'The limit is ' . number_format(self::RENDER_MAX_CHARS) . ' characters (~1 MB). Please shorten or split it into smaller agreements.',
            ], 422);
        }

        // Body = the draft content ONLY. The agreement title used to be printed
        // as a top heading here, but it duplicated the title the draft body
        // already carries — so the Word file now starts straight at the draft.
        // (Logo / header / footer are managed in the editor and ride in the
        // page-shell above, not in the body.)
        $html = trim((string) $row->content);
        if ($html === '') $html = '<p></p>';

        $html    = $this->normaliseEditorHtml($html);
        // Repair the loose contentEditable HTML into well-formed XHTML first —
        // without this, PhpWord's strict reader throws on unclosed tags and we
        // fall into the strip_tags() branch, which flattens the whole agreement
        // (headings, tables, line breaks) into one run-on paragraph.
        $html    = $this->toWellFormedHtml($html);
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
        $lookup = ClmAgreementLibrary::query()->whereKey($id);
        MasterVisibility::applyReadScope($lookup, $user, $user->branch_id ?: null);
        $row = $lookup->firstOrFail();

        // dompdf is memory- and time-heavy for long / table-rich agreements. The
        // web SAPI's default limits are lower than CLI, so a big document crashes
        // the PHP process mid-render → an empty 500 (no Laravel error body). Raise
        // both generously so content up to the ~1 MB cap can render.
        @ini_set('memory_limit', '1024M');
        @set_time_limit(300);

        // Guard oversized content: past this, dompdf crashes the request (500).
        // Return a clean message the UI can show instead.
        if (($len = mb_strlen((string) $row->content)) > self::RENDER_MAX_CHARS) {
            return response()->json([
                'status'  => false,
                'message' => 'This agreement is too large to generate as a PDF — '
                    . number_format(round($len / 1024 / 1024, 2), 2) . ' MB (' . number_format($len) . ' characters). '
                    . 'The limit is ' . number_format(self::RENDER_MAX_CHARS) . ' characters (~1 MB). Please shorten or split it into smaller agreements.',
            ], 422);
        }

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
        $lookup = ClmAgreementLibrary::query()->whereKey($id);
        MasterVisibility::applyReadScope($lookup, $user, $user->branch_id ?: null);
        $row = $lookup->firstOrFail();
        if ($msg = MasterVisibility::hierarchicalDenial($user, $row, 'edit')) {
            return response()->json(['status' => false, 'message' => $msg], 403);
        }

        $request->validate(['docx' => 'required|file|mimes:doc,docx|max:' . self::DOCX_MAX_KB]);

        // Converting a Word file to editor HTML (docxToHtml) loads the whole
        // document.xml into memory + DOMDocument — heavy for a big file. Without
        // this the web SAPI runs out of memory/time and the conversion silently
        // fails, leaving the editor blank. Raise both for this request only.
        @ini_set('memory_limit', '1024M');
        @set_time_limit(300);

        $file       = $request->file('docx');
        $clientSlug = $user->client_id ? 'c' . $user->client_id : 'public';
        $folder     = "agreement_library/{$clientSlug}/a{$row->id}";
        $ext        = strtolower($file->getClientOriginalExtension() ?: 'docx');
        $filename   = Str::random(16) . '.' . $ext;
        $path       = $file->storeAs($folder, $filename, 'public');

        // Best-effort DOCX → HTML so the web editor reflects the upload.
        // Read the stored BYTES into a temp LOCAL file before converting: on a
        // cloud disk (Azure Blob, used on the server) Storage::path() returns an
        // unreadable path, so ZipArchive/PhpWord silently fail and the editor
        // goes blank. ->get() works on both local and cloud disks.
        $html = $row->content;
        $tmpDocx = tempnam(sys_get_temp_dir(), 'docxconv_') . '.docx';
        try {
            file_put_contents($tmpDocx, Storage::disk('public')->get($path));
            $html = $this->docxToHtml($tmpDocx) ?: $row->content;
        } catch (\Throwable $e) {
            // ignore — keep the previous HTML if parsing failed
        } finally {
            @unlink($tmpDocx);
        }

        // Reject a document whose text is over the render cap: it could never be
        // downloaded as PDF/Word afterwards. Drop the stored file and tell the
        // user, instead of leaving un-exportable content in the editor.
        if (($len = mb_strlen((string) $html)) > self::RENDER_MAX_CHARS) {
            Storage::disk('public')->delete($path);
            return response()->json([
                'status'  => false,
                'message' => 'This document is too large — '
                    . number_format(round($len / 1024 / 1024, 2), 2) . ' MB (' . number_format($len) . ' characters). '
                    . 'The limit is ' . number_format(self::RENDER_MAX_CHARS) . ' characters (~1 MB). Please upload a smaller file or split it.',
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
}
